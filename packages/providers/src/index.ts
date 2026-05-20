// Types
export type {
  IVideoProvider,
  ProviderAdapterResult,
  ProviderMetadataResult,
  ProviderOptions,
  ProviderCapabilities,
  TranscriptResult,
  TranscriptSource,
  TranscriptAcquisitionStatus,
} from './types/provider.js';
export {
  VideoProvider,
  ProviderMode,
  type VideoMetadata,
  type TranscriptSegment,
} from './types/provider.js';

// Errors
export {
  ProviderError,
  ProviderFeatureUnsupportedError,
  TranscriptUnavailableError,
  ExtractionFailureError,
  RateLimitError,
  TemporaryProviderFailureError,
} from './errors.js';

// Adapters
export { YouTubeProvider } from './adapters/youtube/index.js';
export { InstagramProvider } from './adapters/instagram/index.js';
export { TikTokProvider } from './adapters/tiktok/index.js';

// Registry and validation
export { ProviderRegistry } from './registry.js';
export { URLValidator, URLValidationError } from './url-validator.js';
