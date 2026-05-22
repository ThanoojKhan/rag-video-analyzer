import type { FastifyInstance } from 'fastify';
import { ProviderHealthTracker } from '@rag/shared';

export async function systemRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/api/v1/system/providers', async (request, reply) => {
    if (process.env.NODE_ENV === 'production') {
      return reply.status(403).send({ error: 'Forbidden in production' });
    }

    const hasGoogle = Boolean(process.env.GOOGLE_API_KEY);

    return reply.send({
      llmProvider: hasGoogle ? 'gemini' : 'mock',
      embeddingProvider: 'bge-small-local',
      chatModel: 'gemini-1.5-flash',
      embeddingModel: 'Xenova/bge-small-en-v1.5',
      mockMode: !hasGoogle,
      streamingEnabled: true,
      providerHealth: ProviderHealthTracker.getHealth(),
    });
  });
}
