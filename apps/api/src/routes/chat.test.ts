import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { AppEnv, ChatResponse } from '@rag/shared';
import { createApp } from '../app';
import { RAGOrchestrator, conversationStore } from '@rag/ai';

vi.mock('@rag/ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@rag/ai')>();

  const mockInvoke = vi.fn();
  const mockStream = vi.fn();

  const MockRAGOrchestrator = vi.fn().mockImplementation(() => ({
    invoke: mockInvoke,
    stream: mockStream,
  }));

  return {
    ...actual,
    RAGOrchestrator: MockRAGOrchestrator,
    conversationStore: {
      getConversation: vi.fn(),
      createConversation: vi.fn(),
      addTurn: vi.fn(),
      getRecentTurns: vi.fn().mockReturnValue([]),
      listConversations: vi.fn().mockReturnValue([]),
      size: vi.fn().mockReturnValue(0),
    },
  };
});

const testEnv: AppEnv = {
  HOST: '0.0.0.0',
  PORT: 4000,
  PORT_FALLBACK: false,
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/testdb',
  REDIS_URL: 'redis://localhost:6379',
};

function getMockInvoke(): ReturnType<typeof vi.fn> {
  const instance = vi.mocked(RAGOrchestrator).mock.results[0];
  if (instance && instance.type === 'return') {
    return (instance.value as { invoke: ReturnType<typeof vi.fn> }).invoke;
  }
  throw new Error('RAGOrchestrator not yet instantiated');
}

function getMockStream(): ReturnType<typeof vi.fn> {
  const instance = vi.mocked(RAGOrchestrator).mock.results[0];
  if (instance && instance.type === 'return') {
    return (instance.value as { stream: ReturnType<typeof vi.fn> }).stream;
  }
  throw new Error('RAGOrchestrator not yet instantiated');
}

describe('Chat Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /api/v1/chat/message', () => {
    const mockResponse: ChatResponse = {
      conversationId: 'conv-123',
      turnId: 'turn-456',
      answer: 'The hook uses a rhetorical question [REF-1].',
      citations: [
        {
          refIndex: 1,
          videoId: 'video-1',
          videoTitle: 'Test Video',
          videoUrl: 'https://example.com/v1',
          creatorName: 'Creator A',
          startSeconds: 0,
          endSeconds: 30,
          chunkId: 'chunk-1',
          transcriptSource: 'native',
          relevanceScore: 0.85,
        },
      ],
      analysisType: 'hook_analysis',
      latencyMs: 150,
    };

    it('returns 200 with ChatResponse on valid request', async () => {
      const app = await createApp(testEnv, {
        disconnectDatabase: async () => undefined,
      });

      getMockInvoke().mockResolvedValue(mockResponse);

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/chat/message',
        payload: {
          message: 'How does the creator grab attention?',
          videoIds: ['video-1'],
          analysisType: 'hook_analysis',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.conversationId).toBe('conv-123');
      expect(body.answer).toContain('[REF-1]');
      expect(body.citations).toHaveLength(1);
      expect(body.citations[0].videoTitle).toBe('Test Video');
    });

    it('returns 400 on missing message', async () => {
      const app = await createApp(testEnv, {
        disconnectDatabase: async () => undefined,
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/chat/message',
        payload: {
          videoIds: ['video-1'],
        },
      });

      // Fastify schema validation will reject this
      expect(response.statusCode).toBe(400);
    });

    it('returns 500 when orchestrator throws', async () => {
      const app = await createApp(testEnv, {
        disconnectDatabase: async () => undefined,
      });

      getMockInvoke().mockRejectedValue(new Error('Pipeline failure'));

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/chat/message',
        payload: {
          message: 'Will fail',
        },
      });

      expect(response.statusCode).toBe(500);
      const body = response.json();
      expect(body.success).toBe(false);
    });
  });

  describe('POST /api/v1/chat/stream', () => {
    it('returns 200 with text/event-stream content type', async () => {
      const app = await createApp(testEnv, {
        disconnectDatabase: async () => undefined,
      });

      async function* mockStreamGen(): AsyncGenerator<
        | { type: 'token'; content: string }
        | {
            type: 'done';
            conversationId: string;
            turnId: string;
            latencyMs: number;
            citations: never[];
          },
        void,
        undefined
      > {
        yield { type: 'token', content: 'Hello ' };
        yield { type: 'token', content: 'world' };
        yield {
          type: 'done',
          conversationId: 'conv-stream',
          turnId: 'turn-stream',
          latencyMs: 100,
          citations: [],
        };
      }

      getMockStream().mockReturnValue(mockStreamGen());

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/chat/stream',
        payload: {
          message: 'Stream test',
          videoIds: [],
          analysisType: 'general',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('text/event-stream');

      // Parse SSE frames
      const rawBody = response.body;
      const frames = rawBody
        .split('\n\n')
        .filter((f: string) => f.startsWith('data: '))
        .map((f: string) => JSON.parse(f.replace('data: ', '')) as { type: string });

      expect(frames.length).toBeGreaterThanOrEqual(2);
      expect(frames[0]!.type).toBe('token');
      expect(frames[frames.length - 1]!.type).toBe('done');
    });
  });

  describe('GET /api/v1/chat/conversations/:id', () => {
    it('returns 404 for non-existent conversation', async () => {
      const app = await createApp(testEnv, {
        disconnectDatabase: async () => undefined,
      });

      vi.mocked(conversationStore.getConversation).mockReturnValue(undefined);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/chat/conversations/nonexistent',
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().success).toBe(false);
    });

    it('returns 200 with conversation data', async () => {
      const app = await createApp(testEnv, {
        disconnectDatabase: async () => undefined,
      });

      vi.mocked(conversationStore.getConversation).mockReturnValue({
        conversationId: 'conv-1',
        videoIds: ['video-1'],
        analysisType: 'general',
        turns: [
          {
            turnId: 't1',
            role: 'user',
            content: 'Hello',
            createdAt: new Date().toISOString(),
          },
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/chat/conversations/conv-1',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.success).toBe(true);
      expect(body.conversation.conversationId).toBe('conv-1');
      expect(body.conversation.turns).toHaveLength(1);
    });
  });
});
