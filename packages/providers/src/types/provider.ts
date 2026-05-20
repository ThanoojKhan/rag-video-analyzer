/**
 * Shared provider interface and types for video platform adapters.
 */

export enum VideoProvider {
  YOUTUBE = 'youtube',
  INSTAGRAM = 'instagram',
  TIKTOK = 'tiktok',
}

export enum ProviderMode {
  MOCK = 'mock',
  REAL = 'real',
}

export interface ProviderCapabilities {
  supportsMetadata: boolean;
  supportsTranscript: boolean;
  supportsNativeTranscript: boolean;
  supportsFallbackTranscript: boolean;
}

export type TranscriptSource = 'NATIVE' | 'YT_DLP' | 'WHISPER' | 'MOCK' | 'UNKNOWN';

export type TranscriptAcquisitionStatus = 'AVAILABLE' | 'UNAVAILABLE' | 'UNSUPPORTED' | 'FAILED';

export interface ProviderOptions {
  mode?: ProviderMode;
}

export interface TranscriptSegment {
  sequenceIndex: number;
  startSeconds: number;
  endSeconds: number;
  text: string;
  sourceType: 'NATIVE' | 'EXTRACTED' | 'GENERATED';
}

export interface VideoMetadata {
  platformVideoId: string;
  canonicalUrl: string;
  title: string;
  description: string;
  creatorName: string;
  creatorHandle: string;
  followerCount: number;
  views: number;
  likes: number;
  comments: number;
  engagementRate: number;
  durationSeconds: number;
  hashtags: string[];
  thumbnailUrl: string;
  uploadDate: Date;
}

export interface ProviderMetadataResult {
  metadata: VideoMetadata;
  sourceAttribution: string;
  confidence?: number;
}

export interface TranscriptResult {
  segments: TranscriptSegment[];
  duration: number;
  language: string;
  hasNativeTranscript: boolean;
  status: TranscriptAcquisitionStatus;
  sourceAttribution: TranscriptSource;
  confidence?: number;
}

export interface ProviderAdapterResult {
  metadata: ProviderMetadataResult;
  transcript: TranscriptResult | null;
}

export interface IVideoProvider {
  /**
   * Check if this adapter can handle the given URL.
   */
  canHandle(url: string): boolean;

  /**
   * Extract platform video ID from URL.
   */
  extractVideoId(url: string): string | null;

  /**
   * Normalize URL to canonical form.
   */
  normalizeUrl(url: string): string | null;

  /**
   * Describe supported provider capabilities.
   */
  capabilities(): ProviderCapabilities;

  /**
   * Fetch video metadata from the platform.
   */
  fetchMetadata(videoId: string, options?: ProviderOptions): Promise<ProviderMetadataResult>;

  /**
   * Fetch transcript/subtitles for the video.
   */
  fetchTranscript(videoId: string, options?: ProviderOptions): Promise<TranscriptResult | null>;

  /**
   * Fetch full provider result.
   */
  fetchVideo(videoId: string, options?: ProviderOptions): Promise<ProviderAdapterResult>;

  /**
   * Get provider identifier for the adapter.
   */
  getProvider(): VideoProvider;
}
