import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import type { AppEnv } from '@rag/shared';
import { healthRoutes } from './routes/health.js';

export interface AppDependencies {
  disconnectDatabase: () => Promise<void>;
}

export async function createApp(
  env: AppEnv,
  dependencies: AppDependencies,
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
      serializers: {
        error: (error: Error) => ({
          name: error.name,
          message: error.message,
          stack: env.NODE_ENV === 'production' ? undefined : error.stack,
        }),
      },
    },
    genReqId: (request) => {
      const incomingRequestId = request.headers['x-request-id'];
      return typeof incomingRequestId === 'string' && incomingRequestId.length > 0
        ? incomingRequestId
        : randomUUID();
    },
    trustProxy: env.NODE_ENV === 'production',
    requestTimeout: 30_000,
    bodyLimit: 1_048_576,
  });

  await app.register(cors, {
    origin:
      env.NODE_ENV === 'production'
        ? (origin, callback) => {
            callback(null, !origin || origin === env.CORS_ORIGIN);
          }
        : true,
  });

  app.addHook('onClose', async () => {
    await dependencies.disconnectDatabase();
  });

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ error }, 'Request failed');
    void reply.status(error.statusCode ?? 500).send({
      status: 'error',
      message: error.message || 'Internal Server Error',
      requestId: request.id,
    });
  });

  await healthRoutes(app);

  return app;
}
