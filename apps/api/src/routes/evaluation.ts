import type { FastifyInstance } from 'fastify';
import { RetrievalEvaluator } from '@rag/ai';
import {
  retrievalEvaluationReportSchema,
  bulkEvaluationReportSchema,
  evaluationScenarioSchema,
  retrievalResultSchema,
  retrievalRankingDiagnosticsSchema,
} from '@rag/shared';
import { z } from 'zod';

const evaluateRequestSchema = z.object({
  textQuery: z.string(),
  results: z.array(retrievalResultSchema),
  diagnostics: z.array(retrievalRankingDiagnosticsSchema),
  retrievalLatencyMs: z.number(),
  comparativeBalanced: z.boolean(),
});

/**
 * Register retrieval evaluation API routes.
 */
export async function evaluationRoutes(app: FastifyInstance): Promise<void> {
  const retrievalLogger = {
    info: (msg: string, meta?: unknown) => app.log.info({ meta }, msg),
    warn: (msg: string, meta?: unknown) => app.log.warn({ meta }, msg),
    error: (msg: string, meta?: unknown) => app.log.error({ meta }, msg),
    debug: (msg: string, meta?: unknown) => app.log.debug({ meta }, msg),
  };

  /**
   * POST /api/v1/retrieval/evaluate
   * Evaluate a single query's retrieved chunks and return the evaluation report.
   */
  app.post<{ Body: unknown }>('/api/v1/retrieval/evaluate', async (request, reply) => {
    const requestId = String(request.id);
    const nodeEnv = process.env.NODE_ENV || 'development';

    if (nodeEnv === 'production') {
      return reply.code(403).send({
        success: false,
        error: 'Forbidden: evaluation endpoints are disabled in production.',
        requestId,
      });
    }

    try {
      const body = evaluateRequestSchema.parse(request.body);

      const report = await RetrievalEvaluator.evaluateRetrieval(
        body.textQuery,
        body.results,
        body.diagnostics,
        body.retrievalLatencyMs,
        body.comparativeBalanced,
        retrievalLogger,
      );

      const validatedReport = retrievalEvaluationReportSchema.parse(report);
      return reply.code(200).send({
        success: true,
        report: validatedReport,
        requestId,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.code(400).send({
          success: false,
          error: 'Validation failed',
          details: error.errors,
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
  });

  /**
   * GET /api/v1/retrieval/eval-scenarios
   * Get pre-configured deterministic evaluation scenarios.
   */
  app.get('/api/v1/retrieval/eval-scenarios', async (request, reply) => {
    const requestId = String(request.id);
    const nodeEnv = process.env.NODE_ENV || 'development';

    if (nodeEnv === 'production') {
      return reply.code(403).send({
        success: false,
        error: 'Forbidden: evaluation endpoints are disabled in production.',
        requestId,
      });
    }

    try {
      const scenarios = RetrievalEvaluator.getDeterministicScenarios();
      const validatedScenarios = z.array(evaluationScenarioSchema).parse(scenarios);
      return reply.code(200).send({
        success: true,
        scenarios: validatedScenarios,
        requestId,
      });
    } catch (error) {
      app.log.error(error instanceof Error ? error : String(error));
      return reply.code(500).send({
        success: false,
        error: 'Internal server error',
        requestId,
      });
    }
  });

  /**
   * POST /api/v1/retrieval/eval-run-scenarios
   * Run all evaluation scenarios and return the bulk evaluation report.
   */
  app.post('/api/v1/retrieval/eval-run-scenarios', async (request, reply) => {
    const requestId = String(request.id);
    const nodeEnv = process.env.NODE_ENV || 'development';

    if (nodeEnv === 'production') {
      return reply.code(403).send({
        success: false,
        error: 'Forbidden: evaluation endpoints are disabled in production.',
        requestId,
      });
    }

    try {
      const report = await RetrievalEvaluator.runEvaluationScenarios(retrievalLogger);
      const validatedReport = bulkEvaluationReportSchema.parse(report);
      return reply.code(200).send({
        success: true,
        report: validatedReport,
        requestId,
      });
    } catch (error) {
      app.log.error(error instanceof Error ? error : String(error));
      return reply.code(500).send({
        success: false,
        error: 'Internal server error',
        requestId,
      });
    }
  });
}
