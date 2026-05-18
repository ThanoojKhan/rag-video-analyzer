import type { FastifyInstance } from 'fastify';
import { healthResponseSchema } from '@rag/shared';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => {
    const payload = {
      status: 'ok' as const,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };

    return healthResponseSchema.parse(payload);
  });
}
