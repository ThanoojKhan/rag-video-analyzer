import type { FastifyInstance } from 'fastify';
import { RAGOrchestrator, conversationStore, RetrievalService } from '@rag/ai';
import { chatRequestSchema, ProviderError, ProviderHealthTracker } from '@rag/shared';

/**
 * Register chat API routes.
 *
 * POST /api/v1/chat/message   — Non-streaming chat
 * POST /api/v1/chat/stream    — SSE streaming chat
 * GET  /api/v1/chat/conversations/:id — Retrieve conversation history
 */
export async function chatRoutes(app: FastifyInstance): Promise<void> {
  const logger = {
    info: (msg: string, meta?: unknown): void => app.log.info({ meta }, msg),
    warn: (msg: string, meta?: unknown): void => app.log.warn({ meta }, msg),
    error: (msg: string, meta?: unknown): void => app.log.error({ meta }, msg),
    debug: (msg: string, meta?: unknown): void => app.log.debug({ meta }, msg),
  };

  const orchestrator = new RAGOrchestrator({
    retrievalService: new RetrievalService(),
    memoryStore: conversationStore,
    logger,
  });

  app.post(
    '/api/v1/chat/message',
    {
      schema: {
        body: {
          type: 'object',
          required: ['message'],
          properties: {
            message: { type: 'string', minLength: 1 },
            conversationId: { type: 'string' },
            videoIds: { type: 'array', items: { type: 'string' } },
            analysisType: {
              type: 'string',
              enum: ['comparative', 'hook_analysis', 'engagement', 'cta', 'pacing', 'general'],
            },
            limit: { type: 'integer', minimum: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      const requestId = String(request.id);
      try {
        const validated = chatRequestSchema.parse(request.body);
        const isDevelopment = process.env.NODE_ENV !== 'production';

        const response = await orchestrator.invoke(validated, isDevelopment);

        return reply.code(200).send({
          success: true,
          ...response,
          requestId,
        });
      } catch (error) {
        if (error instanceof Error && error.name === 'ZodError') {
          return reply.code(400).send({
            success: false,
            error: 'Validation error',
            details: error,
            requestId,
          });
        }

        // Handle ProviderErrors safely for synchronous invokes
        if (error instanceof ProviderError) {
          app.log.warn(
            { code: error.code, message: error.message },
            `Provider error caught in synchronous chat`,
          );
          return reply.code(error.status || 500).send({
            success: false,
            error: error.userSafeMessage,
            code: error.code,
            requestId,
          });
        }

        app.log.error(error instanceof Error ? error : String(error));
        return reply.code(500).send({
          success: false,
          error: 'Internal server error',
          requestId,
        });
      }
    },
  );

  app.post(
    '/api/v1/chat/stream',
    {
      schema: {
        body: {
          type: 'object',
          required: ['message'],
          properties: {
            message: { type: 'string', minLength: 1 },
            conversationId: { type: 'string' },
            videoIds: { type: 'array', items: { type: 'string' } },
            analysisType: {
              type: 'string',
              enum: ['comparative', 'hook_analysis', 'engagement', 'cta', 'pacing', 'general'],
            },
            limit: { type: 'integer', minimum: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const validated = chatRequestSchema.parse(request.body);

        const raw = reply.raw;
        const headers = reply.getHeaders();
        raw.writeHead(200, {
          ...headers,
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'X-Request-Id': String(request.id),
        } as import('http').OutgoingHttpHeaders);

        const streamGenerator = orchestrator.stream(validated);

        for await (const event of streamGenerator) {
          const sseData = `data: ${JSON.stringify(event)}\n\n`;
          raw.write(sseData);

          if (typeof (raw as NodeJS.WritableStream & { flush?: () => void }).flush === 'function') {
            (raw as NodeJS.WritableStream & { flush?: () => void }).flush!();
          }

          if (raw.destroyed) {
            logger.warn('[chat:stream] Client disconnected during streaming');
            break;
          }

          if (event.type === 'done' && event.latencyMs) {
            ProviderHealthTracker.reportLatency(event.latencyMs);
          }
        }

        raw.end();
        void reply.hijack();
      } catch (error) {
        if (error instanceof Error && error.name === 'ZodError') {
          return reply.code(400).send({
            success: false,
            error: 'Validation error',
            details: error,
          });
        }
        app.log.error(error instanceof Error ? error : String(error));

        if (reply.raw.headersSent) {
          const errorEvent = JSON.stringify({
            type: 'error',
            message: error instanceof Error ? error.message : 'Internal server error',
          });
          reply.raw.write(`data: ${errorEvent}\n\n`);
          reply.raw.end();
          void reply.hijack();
          return;
        }

        return reply.code(500).send({
          success: false,
          error: 'Internal server error',
        });
      }
    },
  );

  app.get<{ Params: { id: string } }>('/api/v1/chat/conversations/:id', async (request, reply) => {
    const { id } = request.params;
    const conversation = conversationStore.getConversation(id);

    if (!conversation) {
      return reply.code(404).send({
        success: false,
        error: 'Conversation not found',
        requestId: String(request.id),
      });
    }

    return reply.code(200).send({
      success: true,
      conversation,
      requestId: String(request.id),
    });
  });
}
