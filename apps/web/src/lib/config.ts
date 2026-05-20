export const apiBaseUrl = (() => {
  const raw = process.env.NEXT_PUBLIC_API_BASE_URL?.trim() ?? '';

  if (!raw) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        '[Web API] NEXT_PUBLIC_API_BASE_URL is not configured. Set this environment variable to the ingestion API URL.',
      );
    }
    return '';
  }

  try {
    new URL(raw);
    if (process.env.NODE_ENV !== 'production') {
      console.debug('[Web API] API base URL configured:', raw);
    }
    return raw;
  } catch {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[Web API] NEXT_PUBLIC_API_BASE_URL is not a valid URL:', raw);
    }
    return '';
  }
})();

export function getApiBaseUrl(): string {
  if (!apiBaseUrl) {
    throw new Error(
      'Missing NEXT_PUBLIC_API_BASE_URL. Set the frontend environment variable to the ingestion API base URL.',
    );
  }
  return apiBaseUrl;
}
