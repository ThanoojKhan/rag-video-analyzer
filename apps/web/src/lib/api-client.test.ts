import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const originalFetch = globalThis.fetch;

describe('api-client', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'https://api.example.com');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllGlobals();
  });

  it('fetchWithTimeout should return parsed JSON on success', async () => {
    const { fetchWithTimeout } = await import('./api-client');

    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      url: 'https://api.example.com/api/v1/videos/123',
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => JSON.stringify({ foo: 'bar' }),
    } as unknown as Response);

    const result = await fetchWithTimeout<{ foo: string }>('/api/v1/videos/123');
    expect(result).toEqual({ foo: 'bar' });
  });

  it('fetchWithTimeout should throw ApiClientError for backend HTTP errors', async () => {
    const { fetchWithTimeout, ApiClientError } = await import('./api-client');

    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      url: 'https://api.example.com/api/v1/videos/123',
      status: 500,
      statusText: 'Internal Server Error',
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => JSON.stringify({ error: 'Something went wrong', requestId: 'req-123' }),
    } as unknown as Response);

    const error = await fetchWithTimeout('/api/v1/videos/123').catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ApiClientError);
    if (error instanceof ApiClientError) {
      expect(error.message).toBe('Something went wrong');
      expect(error.payload?.requestId).toBe('req-123');
      expect(error.status).toBe(500);
    }
  });

  it('fetchWithTimeout should throw timeout ApiClientError when request is aborted', async () => {
    const { fetchWithTimeout, ApiClientError } = await import('./api-client');

    globalThis.fetch = vi.fn().mockImplementation(
      (_url, options) =>
        new Promise((resolve, reject) => {
          const signal = options?.signal as AbortSignal | undefined;
          signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        }),
    );

    await expect(fetchWithTimeout('/api/v1/videos/123', undefined, 10)).rejects.toBeInstanceOf(
      ApiClientError,
    );
  });
});
