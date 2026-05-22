import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import type { AppEnv } from '@rag/shared';
import { healthRoutes } from './routes/health.js';
import { ingestionRoutes } from './routes/ingestion.js';
import { diagnosticsRoutes } from './routes/diagnostics.js';
import { retrievalRoutes } from './routes/retrieval.js';
import { evaluationRoutes } from './routes/evaluation.js';
import { chatRoutes } from './routes/chat.js';
import { systemRoutes } from './routes/system.js';

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
    requestTimeout: 120_000,
    bodyLimit: 1_048_576,
    disableRequestLogging: true,
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

  app.addHook('onSend', async (request, reply, payload) => {
    void reply.header('x-request-id', String(request.id));
    return payload;
  });

  await healthRoutes(app);
  await ingestionRoutes(app);
  await diagnosticsRoutes(app);
  await retrievalRoutes(app);
  await evaluationRoutes(app);
  await chatRoutes(app);
  await systemRoutes(app);

  if (env.NODE_ENV !== 'production') {
    app.log.info({ routes: app.printRoutes() }, 'Registered routes');
  }

  return app;
}
