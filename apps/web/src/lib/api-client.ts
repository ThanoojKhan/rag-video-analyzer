import { getApiBaseUrl } from './config';

export interface ApiErrorPayload {
  status?: string;
  error?: string;
  message?: string;
  code?: string;
  requestId?: string;
  configuredBaseUrl?: string;
  [key: string]: unknown;
}

export class ApiClientError extends Error {
  constructor(
    public readonly message: string,
    public readonly status?: number,
    public readonly payload?: ApiErrorPayload,
    public readonly url?: string,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

function buildApiUrl(path: string): { url: string; baseUrl: string } {
  const baseUrl = getApiBaseUrl().replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return { url: `${baseUrl}${normalizedPath}`, baseUrl };
}

function normalizePayload(body: unknown): ApiErrorPayload {
  if (body == null) {
    return {};
  }

  if (typeof body === 'string') {
    return { message: body };
  }

  if (typeof body === 'object' && !Array.isArray(body)) {
    return body as ApiErrorPayload;
  }

  return { message: String(body) };
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const raw = await response.text();
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    console.warn('[Web API] Response body is not valid JSON', {
      url: response.url,
      status: response.status,
      body: raw,
    });
    return raw;
  }
}

export async function fetchWithTimeout<T>(
  path: string,
  init: RequestInit = {},
  timeoutMs = 15_000,
): Promise<T> {
  const { url, baseUrl } = buildApiUrl(path);
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });

    const body = await parseResponseBody(response);

    if (!response.ok) {
      const payload = normalizePayload(body);
      const message =
        payload.error || payload.message || `HTTP ${response.status} ${response.statusText}`;
      const requestId = payload.requestId ?? response.headers.get('x-request-id') ?? undefined;
      throw new ApiClientError(
        message,
        response.status,
        { ...payload, requestId, configuredBaseUrl: baseUrl },
        url,
      );
    }

    return body as T;
  } catch (error) {
    if (error instanceof ApiClientError) {
      throw error;
    }

    const requestId = undefined;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiClientError(
        `Request timed out after ${timeoutMs}ms. Possible causes: slow network, backend delay, or request being blocked.`,
        408,
        { message: 'Request timeout', requestId, configuredBaseUrl: baseUrl },
        url,
      );
    }

    const rawMessage = error instanceof Error ? error.message : String(error);
    const isNetworkError = rawMessage.includes('Failed to fetch');
    const message = isNetworkError
      ? 'Unable to connect to ingestion API. Possible causes: backend not running, invalid API URL, CORS blocked, or network issue.'
      : rawMessage;

    throw new ApiClientError(
      message,
      undefined,
      { message, requestId, configuredBaseUrl: baseUrl },
      url,
    );
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

export function formatApiError(error: unknown): string {
  if (error instanceof ApiClientError) {
    const payload = error.payload ?? {};
    const lines: string[] = [];

    if (error.status === 408) {
      lines.push('The request timed out.');
      lines.push('Possible causes: slow network, backend delay, or request being blocked.');
    } else if (error.status != null) {
      lines.push(`API request failed with status ${error.status}.`);
    } else {
      lines.push('Unable to connect to the ingestion API.');
      lines.push(
        'Possible causes: backend not running, invalid API URL, CORS blocked, or network issue.',
      );
    }

    if (payload.error) {
      lines.push(`Message: ${payload.error}`);
    } else if (payload.message) {
      lines.push(`Message: ${payload.message}`);
    }

    if (payload.configuredBaseUrl) {
      lines.push(`Configured API URL: ${payload.configuredBaseUrl}`);
    }

    if (error.url) {
      lines.push(`Attempted request URL: ${error.url}`);
    }

    if (payload.requestId) {
      lines.push(`Request ID: ${payload.requestId}`);
    }

    return lines.join(' ');
  }

  return error instanceof Error ? error.message : 'An unexpected error occurred.';
}

export interface IngestVideoRequest {
  url: string;
  refreshMetadata?: boolean;
  skipTranscript?: boolean;
}

export interface IngestVideoResponse {
  success: true;
  videoId: string;
  isNew: boolean;
  platform: string;
  title: string;
  durationMs: number;
  requestId?: string;
  jobId?: string;
}

export interface VideoDetails {
  id: string;
  platform: string;
  platformVideoId: string;
  canonicalUrl: string;
  title: string;
  description: string | null;
  creatorName: string | null;
  creatorHandle: string | null;
  followerCount: number;
  views: number;
  likes: number;
  comments: number;
  engagementRate: number;
  durationSeconds: number;
  hashtags: string[];
  thumbnailUrl: string | null;
  uploadDate: string | null;
  ingestionStatus: string;
  lastIngestedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TranscriptSegment {
  id: string;
  videoId: string;
  sequenceIndex: number;
  startSeconds: number;
  endSeconds: number;
  text: string;
  sourceType: 'NATIVE' | 'EXTRACTED' | 'GENERATED';
  createdAt: string;
}

export interface TranscriptResponse {
  videoId: string;
  segments: TranscriptSegment[];
  duration: number;
  segmentCount: number;
}

export interface IngestionJob {
  id: string;
  videoId: string;
  provider: string;
  status: string;
  retryCount: number;
  failureReason: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function ingestVideo(request: IngestVideoRequest): Promise<IngestVideoResponse> {
  return fetchWithTimeout<IngestVideoResponse>('/api/v1/videos/ingest', {
    method: 'POST',
    body: JSON.stringify(request),
  });
}

export async function fetchVideo(videoId: string): Promise<VideoDetails> {
  return fetchWithTimeout<VideoDetails>(`/api/v1/videos/${encodeURIComponent(videoId)}`);
}

export async function fetchTranscript(videoId: string): Promise<TranscriptResponse> {
  return fetchWithTimeout<TranscriptResponse>(
    `/api/v1/videos/${encodeURIComponent(videoId)}/transcript`,
  );
}

export async function fetchIngestionJob(jobId: string): Promise<IngestionJob> {
  return fetchWithTimeout<IngestionJob>(`/api/v1/ingestion-jobs/${encodeURIComponent(jobId)}`);
}
