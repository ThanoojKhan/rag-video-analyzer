import type { FastifyInstance } from 'fastify';
import { healthResponseSchema, type HealthResponse } from '@rag/shared';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  const handler = async (): Promise<HealthResponse> => {
    const payload = {
      status: 'ok' as const,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };

    return healthResponseSchema.parse(payload);
  };

  app.get('/health', handler);
  app.get('/api/health', handler);
}
