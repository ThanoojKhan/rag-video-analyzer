import { describe, expect, it, vi } from 'vitest';
import { pino } from 'pino';
import { createWorkerRuntime, getWorkerEnv } from './index';

const workerEnv = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:15432/ragdb?schema=public',
  REDIS_URL: 'redis://localhost:16379',
} as const;

describe('getWorkerEnv', () => {
  it('validates required worker configuration', () => {
    expect(getWorkerEnv(workerEnv)).toMatchObject(workerEnv);
  });

  it('fails fast when required dependencies are missing', () => {
    expect(() => getWorkerEnv({ NODE_ENV: 'test' })).toThrow(
      'Worker environment validation failed',
    );
  });
});

describe('createWorkerRuntime', () => {
  it('starts and shuts down idempotently', async () => {
    const logger = pino({ level: 'silent' });
    const infoSpy = vi.spyOn(logger, 'info');
    const worker = createWorkerRuntime(getWorkerEnv(workerEnv), logger);

    await worker.start();
    await worker.shutdown('SIGTERM');
    await worker.shutdown('SIGTERM');

    expect(infoSpy).toHaveBeenCalledTimes(2);
  });
});
