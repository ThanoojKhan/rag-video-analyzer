import { pathToFileURL, fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { pino, type Logger } from 'pino';
import { workerEnvSchema, type WorkerEnv } from '@rag/shared';
import { EmbeddingService } from '@rag/ai';
import { prisma } from '@rag/db';

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
  let timerId: NodeJS.Timeout | null = null;
  const pollIntervalMs = 5000;

  const embeddingLogger = {
    info: (msg: string, meta?: unknown) => logger.info({ meta }, msg),
    warn: (msg: string, meta?: unknown) => logger.warn({ meta }, msg),
    error: (msg: string, meta?: unknown) => logger.error({ meta }, msg),
    debug: (msg: string, meta?: unknown) => logger.debug({ meta }, msg),
  };

  const embeddingService = new EmbeddingService(embeddingLogger);

  async function poll(): Promise<void> {
    if (isShuttingDown) {
      return;
    }
    try {
      const pendingJobs = await prisma.videoEmbeddingState.findMany({
        where: { status: 'PENDING' },
        select: { videoId: true },
      });

      if (pendingJobs.length > 0) {
        logger.info(`Worker found ${pendingJobs.length} pending embedding jobs to process`);
      }

      for (const job of pendingJobs) {
        if (isShuttingDown) {
          break;
        }
        try {
          await embeddingService.processVideoEmbeddings(job.videoId);
        } catch (err) {
          logger.error(
            { videoId: job.videoId, error: err instanceof Error ? err.message : String(err) },
            'Error processing video embedding in worker',
          );
        }
      }
    } catch (err) {
      logger.error(
        { error: err instanceof Error ? err.message : String(err) },
        'Error polling database in ingestion worker',
      );
    } finally {
      if (!isShuttingDown) {
        timerId = setTimeout(() => void poll(), pollIntervalMs);
      }
    }
  }

  return {
    async start(): Promise<void> {
      const hasGoogle = Boolean(process.env.GOOGLE_API_KEY);
      logger.info(
        {
          llmProvider: hasGoogle ? 'gemini' : 'mock',
          embeddingModel: 'Xenova/bge-small-en-v1.5',
          mockMode: !hasGoogle,
          nodeEnv: env.NODE_ENV,
        },
        'Ingestion worker started',
      );

      timerId = setTimeout(() => void poll(), pollIntervalMs);
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

      if (timerId) {
        clearTimeout(timerId);
        timerId = null;
      }

      try {
        await prisma.$disconnect();
        logger.info('Database client disconnected');
      } catch (err) {
        logger.error(
          { error: err instanceof Error ? err.message : String(err) },
          'Error disconnecting Database client during shutdown',
        );
      }
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
