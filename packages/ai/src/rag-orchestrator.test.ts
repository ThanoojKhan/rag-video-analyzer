import { vi, describe, it, expect, beforeEach } from 'vitest';
import { RAGOrchestrator, type OrchestratorLogger } from './rag-orchestrator.js';
import { RetrievalService } from './retrieval-service.js';
import { ConversationMemoryStore } from './memory-store.js';
import type { RetrievalContext, ChatRequest, StreamingEvent } from '@rag/shared';

// Mock the RetrievalService
vi.mock('./retrieval-service.js', () => {
  return {
    RetrievalService: vi.fn().mockImplementation(() => ({
      retrieve: vi.fn(),
      retrieveCompare: vi.fn(),
    })),
  };
});

function buildMockRetrievalContext(chunkCount = 2): RetrievalContext & { diagnostics?: unknown } {
  const chunks = Array.from({ length: chunkCount }, (_, i) => ({
    chunkId: `chunk-${i + 1}`,
    videoId: i < chunkCount / 2 ? 'video-1' : 'video-2',
    chunkIndex: i,
    text: `This is transcript content from chunk ${i + 1}. It discusses video production techniques.`,
    tokenCount: 50,
    score: 0.85 - i * 0.05,
    citation: {
      videoId: i < chunkCount / 2 ? 'video-1' : 'video-2',
      videoTitle: i < chunkCount / 2 ? 'Video Alpha' : 'Video Beta',
      videoUrl: `https://example.com/video-${i < chunkCount / 2 ? '1' : '2'}`,
      creatorName: i < chunkCount / 2 ? 'Creator A' : 'Creator B',
      creatorHandle: null,
      startSeconds: i * 30,
      endSeconds: (i + 1) * 30,
      chunkId: `chunk-${i + 1}`,
      transcriptSegmentStart: i * 5,
      transcriptSegmentEnd: (i + 1) * 5,
      transcriptSource: 'native',
    },
  }));

  const groupedContext: Record<string, typeof chunks> = {};
  for (const chunk of chunks) {
    if (!groupedContext[chunk.videoId]) groupedContext[chunk.videoId] = [];
    groupedContext[chunk.videoId]!.push(chunk);
  }

  const formattedContextString = chunks
    .map(
      (c, i) =>
        `[Context Reference ${i + 1}]\nVideo Source: "${c.citation.videoTitle}"\nContent excerpt:\n"""\n${c.text}\n"""`,
    )
    .join('\n\n---\n\n');

  return {
    rawQuery: 'test query',
    retrievedChunks: chunks,
    groupedContext,
    formattedContextString,
    metadata: {
      totalChunks: chunkCount,
      executionTimeMs: 42,
      comparativeBalanced: chunkCount > 2,
    },
    diagnostics: {
      executionTimeMs: 42,
      queryVectorGenerated: true,
      rankingDiagnostics: [],
    },
  };
}

describe('RAGOrchestrator', () => {
  let memoryStore: ConversationMemoryStore;
  let mockRetrieve: ReturnType<typeof vi.fn>;
  let orchestrator: RAGOrchestrator;

  beforeEach(() => {
    vi.clearAllMocks();
    memoryStore = new ConversationMemoryStore();
    mockRetrieve = vi.fn();

    // The mocked RetrievalService constructor returns our mock
    vi.mocked(RetrievalService).mockImplementation(() => {
      return { retrieve: mockRetrieve } as Pick<
        InstanceType<typeof RetrievalService>,
        'retrieve'
      > as InstanceType<typeof RetrievalService>;
    });

    const retrievalService = new RetrievalService({});
    const noOpLogger: OrchestratorLogger = {
      info: () => {},
      error: () => {},
      warn: () => {},
      debug: () => {},
    };

    orchestrator = new RAGOrchestrator({
      retrievalService,
      memoryStore,
      logger: noOpLogger,
    });
  });

  describe('invoke (non-streaming)', () => {
    it('should execute all 5 nodes and return a ChatResponse', async () => {
      const mockCtx = buildMockRetrievalContext(2);
      mockRetrieve.mockResolvedValue(mockCtx);

      const request: ChatRequest = {
        message: 'How does the creator grab attention?',
        videoIds: ['video-1'],
        analysisType: 'hook_analysis',
        stream: false,
        limit: 8,
      };

      const response = await orchestrator.invoke(request, true);

      expect(response.conversationId).toBeDefined();
      expect(response.turnId).toBeDefined();
      expect(response.answer).toBeDefined();
      expect(response.answer.length).toBeGreaterThan(0);
      expect(response.analysisType).toBe('hook_analysis');
      expect(response.latencyMs).toBeGreaterThanOrEqual(0);
      expect(response.citations).toBeDefined();
      expect(Array.isArray(response.citations)).toBe(true);
    });

    it('should create a new conversation when conversationId not provided', async () => {
      mockRetrieve.mockResolvedValue(buildMockRetrievalContext());

      const response = await orchestrator.invoke({
        message: 'Test',
        videoIds: [],
        analysisType: 'general',
        stream: false,
        limit: 8,
      });

      expect(response.conversationId).toBeDefined();
      // Verify conversation exists in memory store
      const conv = memoryStore.getConversation(response.conversationId);
      expect(conv).toBeDefined();
      expect(conv!.turns.length).toBe(2); // user + assistant
    });

    it('should preserve retrieval context in dev mode', async () => {
      mockRetrieve.mockResolvedValue(buildMockRetrievalContext());

      const response = await orchestrator.invoke(
        {
          message: 'Test',
          videoIds: [],
          analysisType: 'general',
          stream: false,
          limit: 8,
        },
        true, // isDevelopment
      );

      expect(response.retrievalContext).toBeDefined();
      expect(response.orchestrationTimings).toBeDefined();
    });

    it('should NOT include retrieval context in production mode', async () => {
      mockRetrieve.mockResolvedValue(buildMockRetrievalContext());

      const response = await orchestrator.invoke(
        {
          message: 'Test',
          videoIds: [],
          analysisType: 'general',
          stream: false,
          limit: 8,
        },
        false, // production
      );

      expect(response.retrievalContext).toBeUndefined();
      expect(response.orchestrationTimings).toBeUndefined();
    });

    it('should extract [REF-N] citations from mock answer', async () => {
      mockRetrieve.mockResolvedValue(buildMockRetrievalContext(3));

      const response = await orchestrator.invoke({
        message: 'Analyze the hook',
        videoIds: ['video-1'],
        analysisType: 'hook_analysis',
        stream: false,
        limit: 8,
      });

      // Mock answer always includes [REF-1] at minimum
      expect(response.citations.length).toBeGreaterThanOrEqual(1);
      expect(response.citations[0]!.refIndex).toBe(1);
      expect(response.citations[0]!.chunkId).toBe('chunk-1');
      expect(response.citations[0]!.videoTitle).toBe('Video Alpha');
    });

    it('should classify scope as comparative for 2+ video IDs', async () => {
      mockRetrieve.mockResolvedValue(buildMockRetrievalContext(4));

      await orchestrator.invoke({
        message: 'Compare hooks',
        videoIds: ['video-1', 'video-2'],
        analysisType: 'comparative',
        stream: false,
        limit: 8,
      });

      // Verify retrieve was called with comparative scope
      expect(mockRetrieve).toHaveBeenCalledTimes(1);
      const callArg = mockRetrieve.mock.calls[0]![0] as { scope: { type: string } };
      expect(callArg.scope.type).toBe('comparative');
    });

    it('should classify scope as global when no video IDs', async () => {
      mockRetrieve.mockResolvedValue(buildMockRetrievalContext());

      await orchestrator.invoke({
        message: 'General question',
        videoIds: [],
        analysisType: 'general',
        stream: false,
        limit: 8,
      });

      const callArg = mockRetrieve.mock.calls[0]![0] as { scope: { type: string } };
      expect(callArg.scope.type).toBe('global');
    });

    it('should return no-context fallback when retrieval returns 0 chunks', async () => {
      mockRetrieve.mockResolvedValue({
        rawQuery: 'test',
        retrievedChunks: [],
        groupedContext: {},
        formattedContextString: 'No relevant video context found.',
        metadata: { totalChunks: 0, executionTimeMs: 5, comparativeBalanced: false },
      });

      const response = await orchestrator.invoke({
        message: 'Something with no data',
        videoIds: [],
        analysisType: 'general',
        stream: false,
        limit: 8,
      });

      expect(response.answer).toContain("don't have sufficient evidence");
      expect(response.citations).toHaveLength(0);
    });

    it('should preserve memory continuity across turns', async () => {
      mockRetrieve.mockResolvedValue(buildMockRetrievalContext());

      const convId = memoryStore.createConversation(['video-1'], 'general');

      // First turn
      await orchestrator.invoke({
        message: 'First question',
        conversationId: convId,
        videoIds: ['video-1'],
        analysisType: 'general',
        stream: false,
        limit: 8,
      });

      // Second turn
      await orchestrator.invoke({
        message: 'Follow-up question',
        conversationId: convId,
        videoIds: ['video-1'],
        analysisType: 'general',
        stream: false,
        limit: 8,
      });

      const conv = memoryStore.getConversation(convId);
      expect(conv!.turns.length).toBe(4); // 2 user + 2 assistant
    });
  });

  describe('stream (SSE streaming)', () => {
    it('should yield token events followed by done event', async () => {
      mockRetrieve.mockResolvedValue(buildMockRetrievalContext());

      const request: ChatRequest = {
        message: 'Analyze the hook',
        videoIds: ['video-1'],
        analysisType: 'hook_analysis',
        stream: true,
        limit: 8,
      };

      const events: StreamingEvent[] = [];
      for await (const event of orchestrator.stream(request)) {
        events.push(event);
      }

      expect(events.length).toBeGreaterThan(0);

      // Should have at least one token event
      const tokenEvents = events.filter((e) => e.type === 'token');
      expect(tokenEvents.length).toBeGreaterThanOrEqual(1);

      // Should end with a done event
      const lastEvent = events[events.length - 1]!;
      expect(lastEvent.type).toBe('done');
      if (lastEvent.type === 'done') {
        expect(lastEvent.conversationId).toBeDefined();
        expect(lastEvent.turnId).toBeDefined();
        expect(lastEvent.latencyMs).toBeGreaterThanOrEqual(0);
      }
    });

    it('should yield citation events for chunks referenced in mock answer', async () => {
      mockRetrieve.mockResolvedValue(buildMockRetrievalContext(3));

      const events: StreamingEvent[] = [];
      for await (const event of orchestrator.stream({
        message: 'Test',
        videoIds: ['video-1'],
        analysisType: 'general',
        stream: true,
        limit: 8,
      })) {
        events.push(event);
      }

      const citationEvents = events.filter((e) => e.type === 'citation');
      expect(citationEvents.length).toBeGreaterThanOrEqual(1);
    });

    it('should yield error event when retrieval fails', async () => {
      mockRetrieve.mockRejectedValue(new Error('DB connection lost'));

      const events: StreamingEvent[] = [];
      for await (const event of orchestrator.stream({
        message: 'Test',
        videoIds: [],
        analysisType: 'general',
        stream: true,
        limit: 8,
      })) {
        events.push(event);
      }

      expect(events).toHaveLength(1);
      expect(events[0]!.type).toBe('error');
      if (events[0]!.type === 'error') {
        expect(events[0]!.message).toContain('DB connection lost');
      }
    });

    it('should save turns to memory after streaming completes', async () => {
      mockRetrieve.mockResolvedValue(buildMockRetrievalContext());

      const events: StreamingEvent[] = [];
      for await (const event of orchestrator.stream({
        message: 'Stream question',
        videoIds: [],
        analysisType: 'general',
        stream: true,
        limit: 8,
      })) {
        events.push(event);
      }

      const doneEvent = events.find((e) => e.type === 'done');
      expect(doneEvent).toBeDefined();
      if (doneEvent && doneEvent.type === 'done') {
        const conv = memoryStore.getConversation(doneEvent.conversationId);
        expect(conv).toBeDefined();
        expect(conv!.turns.length).toBe(2); // user + assistant
      }
    });
  });
});
