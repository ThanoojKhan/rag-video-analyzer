import { pathToFileURL, fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { pino, type Logger } from 'pino';
import { workerEnvSchema, type WorkerEnv } from '@rag/shared';

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });

export interface WorkerRuntime {
  start: () => Promise<void>;
  shutdown: (signal: NodeJS.Signals) => Promise<void>;
}

export function getWorkerEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
  const result = workerEnvSchema.safeParse(source);
  if (!result.success) {
    throw new Error(
      `Worker environment validation failed: ${JSON.stringify(result.error.format())}`,
    );
  }

  return result.data;
}

export function createWorkerRuntime(env: WorkerEnv, logger: Logger): WorkerRuntime {
  let isShuttingDown = false;

  return {
    async start(): Promise<void> {
      logger.info(
        {
          nodeEnv: env.NODE_ENV,
          pid: process.pid,
          uptimeSeconds: Math.round(process.uptime()),
        },
        'Ingestion worker initialized',
      );
    },

    async shutdown(signal: NodeJS.Signals): Promise<void> {
      if (isShuttingDown) {
        return;
      }
      isShuttingDown = true;
      logger.info(
        {
          signal,
          uptimeSeconds: Math.round(process.uptime()),
        },
        'Ingestion worker shutting down',
      );
    },
  };
}

function createLogger(env: WorkerEnv): Logger {
  return pino({
    level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
    serializers: {
      error: (error: Error) => ({
        name: error.name,
        message: error.message,
        stack: env.NODE_ENV === 'production' ? undefined : error.stack,
      }),
    },
  });
}

async function main(): Promise<void> {
  const env = getWorkerEnv();
  const logger = createLogger(env);
  const worker = createWorkerRuntime(env, logger);

  process.on('SIGINT', () => {
    void worker.shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void worker.shutdown('SIGTERM');
  });
  process.on('unhandledRejection', async (reason) => {
    logger.error({ reason }, 'Unhandled worker rejection');
    await worker.shutdown('SIGTERM');
    process.exit(1);
  });
  process.on('uncaughtException', async (error) => {
    logger.error({ error }, 'Uncaught worker exception');
    await worker.shutdown('SIGTERM');
    process.exit(1);
  });

  await worker.start();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
