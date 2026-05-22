import { randomUUID } from 'node:crypto';
import { StateGraph, Annotation, START, END } from '@langchain/langgraph';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import {
  type AnalysisType,
  type ChatCitation,
  type ChatRequest,
  type ChatResponse,
  type StreamingEvent,
  type RetrievalContext,
  type RetrievalDiagnostics,
  type RetrievalQuery,
  type RetrievalFilters,
  ProviderHealthTracker,
  ProviderQuotaExceededError,
  ProviderTransientError,
} from '@rag/shared';
import { RetrievalService } from './retrieval-service.js';
import { ConversationMemoryStore, conversationStore } from './memory-store.js';
import { buildSystemPrompt, buildUserPrompt, buildNoContextResponse } from './prompts.js';

export interface OrchestratorLogger {
  info(msg: string, meta?: unknown): void;
  warn(msg: string, meta?: unknown): void;
  error(msg: string, meta?: unknown): void;
  debug(msg: string, meta?: unknown): void;
}

const noOpLogger: OrchestratorLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

const RAGStateAnnotation = Annotation.Root({
  question: Annotation<string>,
  analysisType: Annotation<AnalysisType>,
  videoIds: Annotation<string[]>,
  conversationId: Annotation<string>,
  limit: Annotation<number>,

  classifiedScope: Annotation<RetrievalQuery['scope']>,

  retrievalContext: Annotation<(RetrievalContext & { diagnostics?: RetrievalDiagnostics }) | null>,

  systemPrompt: Annotation<string>,
  userPrompt: Annotation<string>,

  rawAnswer: Annotation<string>,

  citations: Annotation<ChatCitation[]>,
  response: Annotation<ChatResponse | null>,

  timings: Annotation<Record<string, number>>({
    reducer: (prev, next) => ({ ...prev, ...next }),
    default: () => ({}),
  }),

  errors: Annotation<string[]>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),
});

type RAGState = typeof RAGStateAnnotation.State;

const REF_MARKER_RE = /\[REF-(\d+)\]/g;

function extractCitations(answer: string, retrievalContext: RetrievalContext): ChatCitation[] {
  const chunks = retrievalContext.retrievedChunks;
  const seen = new Set<number>();
  const citations: ChatCitation[] = [];

  let match: RegExpExecArray | null;
  while ((match = REF_MARKER_RE.exec(answer)) !== null) {
    const refNum = parseInt(match[1] ?? '0', 10);
    if (refNum < 1 || refNum > chunks.length) continue;
    if (seen.has(refNum)) continue;
    seen.add(refNum);

    const chunk = chunks[refNum - 1];
    if (!chunk) continue;

    citations.push({
      refIndex: refNum,
      videoId: chunk.citation.videoId,
      videoTitle: chunk.citation.videoTitle,
      videoUrl: chunk.citation.videoUrl,
      creatorName: chunk.citation.creatorName,
      startSeconds: chunk.citation.startSeconds,
      endSeconds: chunk.citation.endSeconds,
      chunkId: chunk.chunkId,
      transcriptSource: chunk.citation.transcriptSource,
      relevanceScore: chunk.score,
    });
  }

  return citations.sort((a, b) => a.refIndex - b.refIndex);
}

/**
 * Generates a deterministic mock synthesis answer when no GOOGLE_API_KEY is set.
 * Includes [REF-N] markers so the citation extraction path is always exercised.
 */
function buildMockAnswer(question: string, retrievalContext: RetrievalContext): string {
  const chunks = retrievalContext.retrievedChunks;
  if (chunks.length === 0) {
    return buildNoContextResponse(question);
  }

  const refMarkers = chunks
    .slice(0, Math.min(chunks.length, 3))
    .map((_, i) => `[REF-${i + 1}]`)
    .join(', ');

  return (
    `[Mock synthesis — no GOOGLE_API_KEY set] ` +
    `Based on the retrieved context (${refMarkers}), here is a summary of the analysis for: "${question}". ` +
    `The top evidence comes from "${chunks[0]?.citation.videoTitle ?? 'the video'}" ` +
    `at ${chunks[0]?.citation.startSeconds.toFixed(0) ?? '0'}s [REF-1].`
  );
}

export class RAGOrchestrator {
  private readonly retrievalService: RetrievalService;
  private readonly memoryStore: ConversationMemoryStore;
  private readonly logger: OrchestratorLogger;
  private readonly googleApiKey?: string;
  private readonly isMockMode: boolean;
  private readonly compiledGraph: ReturnType<typeof this.buildGraph>;

  constructor(deps: {
    retrievalService: RetrievalService;
    memoryStore?: ConversationMemoryStore;
    logger?: OrchestratorLogger;
    googleApiKey?: string;
  }) {
    this.retrievalService = deps.retrievalService;
    this.memoryStore = deps.memoryStore ?? conversationStore;
    this.logger = deps.logger ?? noOpLogger;
    this.googleApiKey = deps.googleApiKey ?? process.env.GOOGLE_API_KEY;
    this.isMockMode = !this.googleApiKey && process.env.NODE_ENV !== 'production';
    this.compiledGraph = this.buildGraph();
  }

  public _createModel(opts?: { streaming?: boolean }): ChatGoogleGenerativeAI {
    return new ChatGoogleGenerativeAI({
      model: 'gemini-2.5-flash',
      temperature: 0.2,
      apiKey: this.googleApiKey,
      ...(opts?.streaming ? { streaming: true } : {}),
    });
  }

  private async classifyQuery(state: RAGState): Promise<Partial<RAGState>> {
    const t0 = Date.now();
    let classifiedScope: RetrievalQuery['scope'];

    if (state.videoIds.length >= 2) {
      classifiedScope = { type: 'comparative', videoIds: state.videoIds };
    } else if (state.videoIds.length === 1) {
      classifiedScope = { type: 'video', videoId: state.videoIds[0]! };
    } else {
      classifiedScope = { type: 'global' };
    }

    return {
      classifiedScope,
      timings: { classify_query: Date.now() - t0 },
    };
  }

  private async retrieveContext(state: RAGState): Promise<Partial<RAGState>> {
    const t0 = Date.now();
    try {
      const filters: RetrievalFilters = {};
      if (state.analysisType === 'hook_analysis') {
        filters.maxStartSeconds = 15;
      }

      const retrievalContext = await this.retrievalService.retrieve({
        textQuery: state.question,
        scope: state.classifiedScope,
        limit: state.limit,
        filters: Object.keys(filters).length > 0 ? filters : undefined,
      });

      this.logger.info('Retrieval operation completed', {
        chunks: retrievalContext.retrievedChunks.length,
      });

      return {
        retrievalContext,
        timings: { retrieve_context: Date.now() - t0 },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error('[node:retrieve_context] Retrieval failed', { error: msg });
      return {
        retrievalContext: null,
        errors: [msg],
        timings: { retrieve_context: Date.now() - t0 },
      };
    }
  }

  private async assembleContext(state: RAGState): Promise<Partial<RAGState>> {
    const t0 = Date.now();
    const systemPrompt = buildSystemPrompt(state.analysisType, state.videoIds.length);
    const memoryTurns = this.memoryStore.getRecentTurns(state.conversationId, 4);
    const formattedContext =
      state.retrievalContext?.formattedContextString ?? 'No context retrieved.';
    const userPrompt = buildUserPrompt(state.question, formattedContext, memoryTurns);
    return {
      systemPrompt,
      userPrompt,
      timings: { assemble_context: Date.now() - t0 },
    };
  }

  private async synthesize(state: RAGState): Promise<Partial<RAGState>> {
    const t0 = Date.now();

    const ctx = state.retrievalContext;

    if (!ctx || ctx.retrievedChunks.length === 0) {
      const fallback = buildNoContextResponse(state.question);
      return {
        rawAnswer: fallback,
        timings: { synthesize: Date.now() - t0 },
      };
    }

    if (!this.googleApiKey) {
      const mockAnswer = buildMockAnswer(state.question, ctx);
      return {
        rawAnswer: mockAnswer,
        timings: { synthesize: Date.now() - t0 },
      };
    }

    try {
      const model = this._createModel();

      const messages = [new SystemMessage(state.systemPrompt), new HumanMessage(state.userPrompt)];

      const response = await model.invoke(messages);
      const rawAnswer =
        typeof response.content === 'string'
          ? response.content
          : response.content
              .filter(
                (c: unknown): c is { type: 'text'; text: string } =>
                  typeof c === 'object' &&
                  c !== null &&
                  'type' in c &&
                  (c as Record<string, unknown>).type === 'text',
              )
              .map((c) => c.text)
              .join('');

      return {
        rawAnswer,
        timings: { synthesize: Date.now() - t0 },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      let typedError: Error = err as Error;
      const status =
        typeof err === 'object' && err !== null && 'status' in err
          ? Number((err as Record<string, unknown>).status)
          : undefined;

      if (status === 429) {
        typedError = new ProviderQuotaExceededError(msg, 429);
        ProviderHealthTracker.reportError(typedError as ProviderQuotaExceededError);
      } else if (status !== undefined && status >= 500) {
        typedError = new ProviderTransientError(msg, status);
        ProviderHealthTracker.reportError(typedError as ProviderTransientError);
      }

      this.logger.error('[node:synthesize] Gemini call failed', { error: msg });

      if (process.env.NODE_ENV === 'development') {
        return {
          rawAnswer: buildMockAnswer(state.question, ctx),
          errors: [msg],
          timings: { synthesize: Date.now() - t0 },
        };
      }

      throw typedError;
    }
  }

  private async formatResponse(state: RAGState): Promise<Partial<RAGState>> {
    const t0 = Date.now();
    const ctx = state.retrievalContext;
    const citations = ctx ? extractCitations(state.rawAnswer, ctx) : [];

    const turnId = randomUUID();
    const totalLatencyMs = Object.values(state.timings).reduce((acc, v) => acc + v, 0);

    const response: ChatResponse = {
      conversationId: state.conversationId,
      turnId,
      answer: state.rawAnswer,
      citations,
      analysisType: state.analysisType,
      latencyMs: totalLatencyMs,
    };

    this.memoryStore.addTurn(state.conversationId, 'user', state.question);
    this.memoryStore.addTurn(state.conversationId, 'assistant', state.rawAnswer, citations);

    return {
      citations,
      response,
      timings: { format_response: Date.now() - t0 },
    };
  }

  private buildGraph(): ReturnType<RAGOrchestrator['compileGraph']> {
    return this.compileGraph();
  }

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  private compileGraph() {
    return new StateGraph(RAGStateAnnotation)
      .addNode('classify_query', (s: RAGState) => this.classifyQuery(s))
      .addNode('retrieve_context', (s: RAGState) => this.retrieveContext(s))
      .addNode('assemble_context', (s: RAGState) => this.assembleContext(s))
      .addNode('synthesize', (s: RAGState) => this.synthesize(s))
      .addNode('format_response', (s: RAGState) => this.formatResponse(s))
      .addEdge(START, 'classify_query')
      .addEdge('classify_query', 'retrieve_context')
      .addEdge('retrieve_context', 'assemble_context')
      .addEdge('assemble_context', 'synthesize')
      .addEdge('synthesize', 'format_response')
      .addEdge('format_response', END)
      .compile();
  }

  async invoke(request: ChatRequest, isDevelopment = false): Promise<ChatResponse> {
    const orchestrationStart = Date.now();

    // Resolve or create conversation
    let conversationId = request.conversationId;
    if (!conversationId) {
      conversationId = this.memoryStore.createConversation(request.videoIds, request.analysisType);
    }

    const initialState: Partial<RAGState> = {
      question: request.message,
      analysisType: request.analysisType,
      videoIds: request.videoIds,
      conversationId,
      limit: request.limit,
      retrievalContext: null,
      systemPrompt: '',
      userPrompt: '',
      rawAnswer: '',
      citations: [],
      response: null,
    };

    const finalState = await this.compiledGraph.invoke(initialState);

    const response = finalState.response;
    if (!response) {
      throw new Error('RAG orchestration failed to produce a response');
    }

    const enriched: ChatResponse = {
      ...response,
      ...(isDevelopment && finalState.retrievalContext
        ? {
            retrievalContext: {
              rawQuery: finalState.retrievalContext.rawQuery,
              retrievedChunks: finalState.retrievalContext.retrievedChunks,
              groupedContext: finalState.retrievalContext.groupedContext,
              formattedContextString: finalState.retrievalContext.formattedContextString,
              metadata: finalState.retrievalContext.metadata,
            },
            orchestrationTimings: finalState.timings,
          }
        : {}),
    };

    this.logger.debug('[orchestrator:invoke] done', {
      latencyMs: Date.now() - orchestrationStart,
      citations: enriched.citations.length,
    });

    return enriched;
  }

  async *stream(request: ChatRequest): AsyncGenerator<StreamingEvent, void, undefined> {
    const streamStart = Date.now();
    const timings: Record<string, number> = {};

    // Resolve or create conversation
    let conversationId = request.conversationId;
    if (!conversationId) {
      conversationId = this.memoryStore.createConversation(request.videoIds, request.analysisType);
    }

    this.logger.info('[orchestrator:stream] Streaming RAG pipeline started', {
      conversationId,
    });

    try {
      const t1 = Date.now();
      let classifiedScope: RetrievalQuery['scope'];
      if (request.videoIds.length >= 2) {
        classifiedScope = { type: 'comparative', videoIds: request.videoIds };
      } else if (request.videoIds.length === 1) {
        classifiedScope = { type: 'video', videoId: request.videoIds[0]! };
      } else {
        classifiedScope = { type: 'global' };
      }
      timings.classify_query = Date.now() - t1;

      const t2 = Date.now();
      let retrievalContext: (RetrievalContext & { diagnostics?: RetrievalDiagnostics }) | null =
        null;
      try {
        retrievalContext = await this.retrievalService.retrieve({
          textQuery: request.message,
          scope: classifiedScope,
          limit: request.limit,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error('Retrieval failed', { error: msg });
        yield { type: 'error', message: msg, code: 'RETRIEVAL_FAILED' };
        return;
      }
      timings.retrieve_context = Date.now() - t2;

      const t3 = Date.now();
      const systemPrompt = buildSystemPrompt(request.analysisType, request.videoIds.length);
      const memoryTurns = this.memoryStore.getRecentTurns(conversationId, 4);
      const formattedContext = retrievalContext?.formattedContextString ?? 'No context retrieved.';
      const userPrompt = buildUserPrompt(request.message, formattedContext, memoryTurns);
      timings.assemble_context = Date.now() - t3;

      const t4 = Date.now();
      let rawAnswer = '';

      const chunks = retrievalContext?.retrievedChunks ?? [];
      if (chunks.length === 0) {
        rawAnswer = buildNoContextResponse(request.message);
        yield { type: 'token', content: rawAnswer };
      } else if (!this.googleApiKey) {
        rawAnswer = buildMockAnswer(request.message, retrievalContext!);
        for (const word of rawAnswer.split(' ')) {
          yield { type: 'token', content: word + ' ' };
          await new Promise<void>((r) => setTimeout(r, 8));
        }
      } else {
        // Live Gemini streaming
        const model = this._createModel({ streaming: true });

        const messages = [new SystemMessage(systemPrompt), new HumanMessage(userPrompt)];

        try {
          const stream = await model.stream(messages);
          for await (const chunk of stream) {
            const tokenContent =
              typeof chunk.content === 'string'
                ? chunk.content
                : (chunk.content as unknown[])
                    .filter(
                      (c: unknown): c is { type: 'text'; text: string } =>
                        typeof c === 'object' &&
                        c !== null &&
                        'type' in c &&
                        (c as Record<string, unknown>).type === 'text',
                    )
                    .map((c) => c.text)
                    .join('');

            if (tokenContent) {
              rawAnswer += tokenContent;
              yield { type: 'token', content: tokenContent };
            }
          }
          ProviderHealthTracker.reportSuccess();
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.error('[orchestrator:stream] Gemini stream failed', { error: msg });

          const status =
            typeof err === 'object' && err !== null && 'status' in err
              ? Number((err as Record<string, unknown>).status)
              : undefined;

          let code = 'provider_failure';
          if (status === 429) {
            code = 'insufficient_quota';
            ProviderHealthTracker.reportError(new ProviderQuotaExceededError(msg, 429));
          } else if (status !== undefined && status >= 500) {
            code = 'transient_provider_failure';
            ProviderHealthTracker.reportError(new ProviderTransientError(msg, status));
          }

          yield {
            type: 'error',
            message:
              code === 'insufficient_quota'
                ? 'The AI provider quota has been exhausted. Please check your billing details.'
                : 'The AI provider encountered an error during synthesis.',
            code,
          };
          return;
        }
      }
      timings.synthesize = Date.now() - t4;

      const t5 = Date.now();
      const citations = retrievalContext ? extractCitations(rawAnswer, retrievalContext) : [];

      for (const citation of citations) {
        yield { type: 'citation', citation };
      }

      const turnId = randomUUID();

      this.memoryStore.addTurn(conversationId, 'user', request.message);
      this.memoryStore.addTurn(conversationId, 'assistant', rawAnswer, citations);

      timings.format_response = Date.now() - t5;

      const totalLatencyMs = Date.now() - streamStart;
      this.logger.info('[orchestrator:stream] Stream complete', {
        conversationId,
        citationCount: citations.length,
        latencyMs: totalLatencyMs,
      });

      yield {
        type: 'done',
        conversationId,
        turnId,
        latencyMs: totalLatencyMs,
        citations,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error('[orchestrator:stream] Unhandled stream error', { error: msg });
      yield { type: 'error', message: msg, code: 'INTERNAL_ERROR' };
    }
  }
}
