import type { FastifyInstance } from 'fastify';
import { ChunkDiagnosticsService } from '@rag/ai';
import { prisma } from '@rag/db';
import { chunkQualityReportSchema } from '@rag/shared';

/**
 * Register chunk diagnostics API routes.
 */
export async function diagnosticsRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string } }>(
    '/api/v1/diagnostics/videos/:id/chunks',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', description: 'Video ID' },
          },
        },
      },
    },
    async (request, reply) => {
      const requestId = String(request.id);
      const nodeEnv = process.env.NODE_ENV || 'development';

      // Protection: block production environment access
      if (nodeEnv === 'production') {
        return reply.code(403).send({
          success: false,
          error: 'Forbidden: diagnostics are disabled in production.',
          requestId,
        });
      }

      try {
        const { id } = request.params;

        // Check if video exists first
        const videoExists = await prisma.video.findUnique({
          where: { id },
          select: { id: true },
        });

        if (!videoExists) {
          return reply.code(404).send({
            success: false,
            error: `Video not found: ${id}`,
            requestId,
          });
        }

        const report = await ChunkDiagnosticsService.analyzeVideoChunks(id);
        const validated = chunkQualityReportSchema.parse(report);

        return reply.send({
          ...validated,
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
    },
  );
}
