import { describe, expect, it } from 'vitest';
import type { AppEnv } from '@rag/shared';
import { createApp } from './app';

const testEnv: AppEnv = {
  HOST: '127.0.0.1',
  PORT: 0,
  PORT_FALLBACK: false,
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:15432/ragdb?schema=public',
  REDIS_URL: 'redis://localhost:16379',
};

describe('createApp', () => {
  it('serves the health endpoint with a stable request id', async () => {
    const app = await createApp(testEnv, {
      disconnectDatabase: async () => undefined,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: {
        'x-request-id': 'test-request-id',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'ok',
    });
    expect(response.json()).toHaveProperty('uptimeSeconds');
    expect(response.json()).toHaveProperty('timestamp');

    await app.close();
  });

  it('does not allow wildcard CORS behavior when configured for production', async () => {
    const app = await createApp(
      {
        ...testEnv,
        NODE_ENV: 'production',
        CORS_ORIGIN: 'https://app.example.com',
      },
      {
        disconnectDatabase: async () => undefined,
      },
    );

    const response = await app.inject({
      method: 'OPTIONS',
      url: '/health',
      headers: {
        origin: 'https://evil.example.com',
        'access-control-request-method': 'GET',
      },
    });

    expect(response.headers['access-control-allow-origin']).toBeUndefined();

    await app.close();
  });
});
