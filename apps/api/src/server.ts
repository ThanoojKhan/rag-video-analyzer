import 'dotenv/config';
import { getAppEnv } from './plugins/env.js';
import { createApp } from './app.js';
import { prisma, preparePgVector } from '@rag/db';

const env = getAppEnv();
const app = await createApp(env, {
  disconnectDatabase: async () => {
    await prisma.$disconnect();
  },
});
let isShuttingDown = false;

async function start(): Promise<void> {
  try {
    await prisma.$connect();
    await preparePgVector(prisma);

    const port = await listenWithLocalFallback(env.PORT);
    app.log.info(
      {
        port,
        host: env.HOST,
        nodeEnv: env.NODE_ENV,
        pid: process.pid,
        uptimeSeconds: Math.round(process.uptime()),
      },
      'API server started',
    );
  } catch (error) {
    app.log.error({ error }, 'Failed to start API server');
    await app.close();
    process.exit(1);
  }
}

async function listenWithLocalFallback(preferredPort: number): Promise<number> {
  const maxAttempts = env.NODE_ENV === 'development' && env.PORT_FALLBACK ? 10 : 1;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const port = preferredPort + attempt;

    try {
      await app.listen({ port, host: env.HOST });
      if (port !== preferredPort) {
        app.log.warn(
          {
            requestedPort: preferredPort,
            selectedPort: port,
          },
          'Requested API port was occupied; started on fallback port',
        );
      }
      return port;
    } catch (error) {
      if (!isAddressInUseError(error)) {
        throw error;
      }

      app.log.warn(
        {
          port,
          fallbackEnabled: env.NODE_ENV === 'development' && env.PORT_FALLBACK,
          hint:
            env.NODE_ENV === 'development'
              ? 'Stop the process using this port or set PORT to a free value in .env.'
              : 'Set PORT to a free value or stop the conflicting process before restarting.',
        },
        'API port is already in use',
      );

      if (attempt === maxAttempts - 1) {
        throw error;
      }
    }
  }

  throw new Error('Unable to bind API server to an available port.');
}

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;
  app.log.info({ signal, uptimeSeconds: Math.round(process.uptime()) }, 'Shutting down API server');
  await app.close();
  app.log.info({ signal }, 'API server stopped');
}

function isAddressInUseError(error: unknown): boolean {
  return (
    error instanceof Error && 'code' in error && (error as { code?: unknown }).code === 'EADDRINUSE'
  );
}

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});
process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
process.on('unhandledRejection', async (reason) => {
  app.log.error({ reason }, 'Unhandled rejection');
  await shutdown('SIGTERM');
  process.exit(1);
});
process.on('uncaughtException', async (error) => {
  app.log.error({ error }, 'Uncaught exception');
  await shutdown('SIGTERM');
  process.exit(1);
});

await start();
