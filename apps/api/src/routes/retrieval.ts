import type { FastifyInstance } from 'fastify';
import { RetrievalService } from '@rag/ai';
import {
  retrievalQueryRequestSchema,
  retrievalCompareRequestSchema,
  retrievalQueryResponseSchema,
  type RetrievalQueryRequest,
  type RetrievalCompareRequest,
} from '@rag/shared';

/**
 * Register retrieval API routes.
 */
export async function retrievalRoutes(app: FastifyInstance): Promise<void> {
  // Pass app logger to RetrievalService for observability
  const retrievalLogger = {
    info: (msg: string, meta?: unknown) => app.log.info({ meta }, msg),
    warn: (msg: string, meta?: unknown) => app.log.warn({ meta }, msg),
    error: (msg: string, meta?: unknown) => app.log.error({ meta }, msg),
    debug: (msg: string, meta?: unknown) => app.log.debug({ meta }, msg),
  };

  const retrievalService = new RetrievalService(retrievalLogger);

  const buildErrorPayload = (
    message: string,
    requestId: string,
  ): { success: false; error: string; requestId: string } => ({
    success: false,
    error: message,
    requestId,
  });

  /**
   * POST /api/v1/retrieval/query
   * Query chunks from a single video or globally.
   */
  app.post<{ Body: RetrievalQueryRequest }>(
    '/api/v1/retrieval/query',
    {
      schema: {
        body: {
          type: 'object',
          required: ['textQuery'],
          properties: {
            textQuery: { type: 'string', description: 'Query text' },
            videoId: { type: 'string', description: 'Optional single video ID scope' },
            filters: {
              type: 'object',
              properties: {
                providers: { type: 'array', items: { type: 'string' } },
                creators: { type: 'array', items: { type: 'string' } },
                transcriptSources: { type: 'array', items: { type: 'string' } },
                ingestionStatuses: {
                  type: 'array',
                  items: {
                    type: 'string',
                    enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'RETRYING'],
                  },
                },
                confidenceThreshold: { type: 'number', minimum: 0, maximum: 1 },
              },
            },
            limit: { type: 'integer', minimum: 1, default: 10 },
            offset: { type: 'integer', minimum: 0, default: 0 },
          },
        },
      },
    },
    async (request, reply) => {
      const requestId = String(request.id);
      const isProduction = process.env.NODE_ENV === 'production';

      try {
        // Validate request schema
        const validated = retrievalQueryRequestSchema.parse(request.body);

        // Execute retrieval
        const retrievalResult = await retrievalService.retrieve(validated);

        const responsePayload = {
          success: true,
          results: retrievalResult.retrievedChunks,
          context: {
            rawQuery: retrievalResult.rawQuery,
            retrievedChunks: retrievalResult.retrievedChunks,
            groupedContext: retrievalResult.groupedContext,
            formattedContextString: retrievalResult.formattedContextString,
            metadata: retrievalResult.metadata,
          },
          ...(!isProduction && retrievalResult.diagnostics
            ? { diagnostics: retrievalResult.diagnostics }
            : {}),
        };

        const validatedResponse = retrievalQueryResponseSchema.parse(responsePayload);
        return reply.code(200).send({ ...validatedResponse, requestId });
      } catch (error) {
        app.log.error(error instanceof Error ? error : String(error));
        return reply.code(500).send(buildErrorPayload('Internal server error', requestId));
      }
    },
  );

  /**
   * POST /api/v1/retrieval/compare
   * Query chunks from multiple videos for comparative analysis.
   */
  app.post<{ Body: RetrievalCompareRequest }>(
    '/api/v1/retrieval/compare',
    {
      schema: {
        body: {
          type: 'object',
          required: ['textQuery', 'videoIds'],
          properties: {
            textQuery: { type: 'string', description: 'Query text' },
            videoIds: { type: 'array', items: { type: 'string' }, minItems: 2 },
            filters: {
              type: 'object',
              properties: {
                providers: { type: 'array', items: { type: 'string' } },
                creators: { type: 'array', items: { type: 'string' } },
                transcriptSources: { type: 'array', items: { type: 'string' } },
                ingestionStatuses: {
                  type: 'array',
                  items: {
                    type: 'string',
                    enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'RETRYING'],
                  },
                },
                confidenceThreshold: { type: 'number', minimum: 0, maximum: 1 },
              },
            },
            limit: { type: 'integer', minimum: 1, default: 10 },
            offset: { type: 'integer', minimum: 0, default: 0 },
          },
        },
      },
    },
    async (request, reply) => {
      const requestId = String(request.id);
      const isProduction = process.env.NODE_ENV === 'production';

      try {
        // Validate request schema
        const validated = retrievalCompareRequestSchema.parse(request.body);

        // Execute comparative retrieval
        const retrievalResult = await retrievalService.retrieveCompare(validated);

        const responsePayload = {
          success: true,
          results: retrievalResult.retrievedChunks,
          context: {
            rawQuery: retrievalResult.rawQuery,
            retrievedChunks: retrievalResult.retrievedChunks,
            groupedContext: retrievalResult.groupedContext,
            formattedContextString: retrievalResult.formattedContextString,
            metadata: retrievalResult.metadata,
          },
          ...(!isProduction && retrievalResult.diagnostics
            ? { diagnostics: retrievalResult.diagnostics }
            : {}),
        };

        const validatedResponse = retrievalQueryResponseSchema.parse(responsePayload);
        return reply.code(200).send({ ...validatedResponse, requestId });
      } catch (error) {
        app.log.error(error instanceof Error ? error : String(error));
        return reply.code(500).send(buildErrorPayload('Internal server error', requestId));
      }
    },
  );
}
