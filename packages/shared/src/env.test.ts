import { describe, expect, it } from 'vitest';
import { appEnvSchema, workerEnvSchema } from './index';

const baseEnv = {
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:15432/ragdb?schema=public',
  REDIS_URL: 'redis://localhost:16379',
};

describe('appEnvSchema', () => {
  it('coerces numeric ports and applies safe development defaults', () => {
    const env = appEnvSchema.parse({
      ...baseEnv,
      PORT: '4010',
      NODE_ENV: 'development',
    });

    expect(env.PORT).toBe(4010);
    expect(env.HOST).toBe('0.0.0.0');
    expect(env.PORT_FALLBACK).toBe(false);
    expect(env.LOG_LEVEL).toBe('info');
  });

  it('parses false boolean strings without enabling fallback accidentally', () => {
    const env = appEnvSchema.parse({
      ...baseEnv,
      PORT_FALLBACK: 'false',
    });

    expect(env.PORT_FALLBACK).toBe(false);
  });

  it('requires an explicit CORS origin in production', () => {
    const result = appEnvSchema.safeParse({
      ...baseEnv,
      NODE_ENV: 'production',
      PORT: '4000',
    });

    expect(result.success).toBe(false);
  });
});

describe('workerEnvSchema', () => {
  it('validates worker runtime dependencies without app-only settings', () => {
    const env = workerEnvSchema.parse({
      ...baseEnv,
      NODE_ENV: 'test',
    });

    expect(env.NODE_ENV).toBe('test');
    expect(env.LOG_LEVEL).toBe('info');
  });
});
