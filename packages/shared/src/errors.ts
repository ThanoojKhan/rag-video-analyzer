export class ProviderError extends Error {
  public code: string;
  public status?: number;
  public userSafeMessage: string;

  constructor(message: string, code: string, userSafeMessage: string, status?: number) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.userSafeMessage = userSafeMessage;
    this.status = status;
  }
}

export class ProviderQuotaExceededError extends ProviderError {
  constructor(message = 'AI Provider Quota Exceeded', status = 429) {
    super(
      message,
      'insufficient_quota',
      'The AI provider quota has been exhausted. Please check your billing details.',
      status,
    );
  }
}

export class ProviderRateLimitError extends ProviderError {
  constructor(message = 'AI Provider Rate Limit Exceeded', status = 429) {
    super(
      message,
      'rate_limit_exceeded',
      'The AI provider is currently rate limiting requests. Please try again in a few moments.',
      status,
    );
  }
}

export class ProviderTimeoutError extends ProviderError {
  constructor(message = 'AI Provider Timeout', status = 504) {
    super(
      message,
      'upstream_timeout',
      'The AI provider took too long to respond. Please try again.',
      status,
    );
  }
}

export class ProviderInvalidKeyError extends ProviderError {
  constructor(message = 'AI Provider Invalid Key', status = 401) {
    super(message, 'invalid_api_key', 'The configured AI provider API key is invalid.', status);
  }
}

export class ProviderTransientError extends ProviderError {
  constructor(message = 'AI Provider Transient Error', status = 503) {
    super(
      message,
      'transient_provider_failure',
      'The AI provider is currently experiencing issues. Please try again later.',
      status,
    );
  }
}

export type ProviderHealthState = 'healthy' | 'degraded' | 'failing';

export interface ProviderErrorRecord {
  code: string;
  message: string;
  timestamp: number;
}

class ProviderHealthTrackerImpl {
  private state: ProviderHealthState = 'healthy';
  private lastError: ProviderErrorRecord | null = null;
  private consecutiveErrors = 0;
  private recentLatencies: number[] = [];

  public reportLatency(latencyMs: number): void {
    this.recentLatencies.push(latencyMs);
    if (this.recentLatencies.length > 20) {
      this.recentLatencies.shift();
    }
  }

  public reportError(error: ProviderError): void {
    this.lastError = {
      code: error.code,
      message: error.message,
      timestamp: Date.now(),
    };

    this.consecutiveErrors++;
    this.state = this.consecutiveErrors >= 3 ? 'failing' : 'degraded';
  }

  public reportSuccess(): void {
    this.consecutiveErrors = 0;
    this.state = 'healthy';
    // We intentionally do not clear lastError so diagnostics can still see what recently failed
  }

  public getHealth(): {
    state: ProviderHealthState;
    lastError: ProviderErrorRecord | null;
    consecutiveErrors: number;
    avgLatencyMs: number | null;
  } {
    const avgLatency =
      this.recentLatencies.length > 0
        ? Math.round(this.recentLatencies.reduce((a, b) => a + b, 0) / this.recentLatencies.length)
        : null;

    return {
      state: this.state,
      lastError: this.lastError,
      consecutiveErrors: this.consecutiveErrors,
      avgLatencyMs: avgLatency,
    };
  }
}

export const ProviderHealthTracker = new ProviderHealthTrackerImpl();
