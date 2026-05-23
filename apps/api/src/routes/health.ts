import type { FastifyInstance } from 'fastify';
import { healthResponseSchema } from '@rag/shared';
import { prisma } from '@rag/db';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  const handler = async (
    request: import('fastify').FastifyRequest,
    reply: import('fastify').FastifyReply,
  ): Promise<import('fastify').FastifyReply> => {
    try {
      // Ping Postgres to ensure the DB is reachable
      if (process.env.NODE_ENV !== 'test') {
        await prisma.$executeRawUnsafe('SELECT 1');
      }

      const payload = {
        status: 'ok' as const,
        uptimeSeconds: Math.round(process.uptime()),
        timestamp: new Date().toISOString(),
      };

      return reply.code(200).send(healthResponseSchema.parse(payload));
    } catch (error) {
      app.log.error({ error }, 'Healthcheck failed: Database unreachable');
      return reply.code(503).send({
        status: 'error',
        message: 'Service Unavailable',
      });
    }
  };

  app.get('/health', handler);
  app.get('/api/health', handler);
}
