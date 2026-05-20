export class ProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderError';
  }
}

export class ProviderFeatureUnsupportedError extends ProviderError {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderFeatureUnsupportedError';
  }
}

export class TranscriptUnavailableError extends ProviderError {
  constructor(message: string) {
    super(message);
    this.name = 'TranscriptUnavailableError';
  }
}

export class ExtractionFailureError extends ProviderError {
  constructor(message: string) {
    super(message);
    this.name = 'ExtractionFailureError';
  }
}

export class RateLimitError extends ProviderError {
  constructor(message: string) {
    super(message);
    this.name = 'RateLimitError';
  }
}

export class TemporaryProviderFailureError extends ProviderError {
  constructor(message: string) {
    super(message);
    this.name = 'TemporaryProviderFailureError';
  }
}
