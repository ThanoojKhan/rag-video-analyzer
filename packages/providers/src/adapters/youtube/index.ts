import {
  ProviderMode,
  ProviderOptions,
  ProviderCapabilities,
  IVideoProvider,
  ProviderMetadataResult,
  TranscriptResult,
  ProviderAdapterResult,
  VideoProvider,
} from '../../types/provider.js';
import { ProviderFeatureUnsupportedError } from '../../errors.js';

/**
 * YouTube video provider adapter.
 *
 * Supports:
 * - youtube.com/watch?v=VIDEO_ID
 * - youtu.be/VIDEO_ID
 * - YouTube Shorts (youtube.com/shorts/VIDEO_ID)
 */
export class YouTubeProvider implements IVideoProvider {
  private readonly videoIdRegex = /^[a-zA-Z0-9_-]{11}$/;

  canHandle(url: string): boolean {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.includes('youtube.com') || urlObj.hostname.includes('youtu.be');
    } catch {
      return false;
    }
  }

  extractVideoId(url: string): string | null {
    try {
      const urlObj = new URL(url);

      // youtu.be/VIDEO_ID
      if (urlObj.hostname === 'youtu.be') {
        const [videoId = ''] = urlObj.pathname.slice(1).split('?');
        return this.validateVideoId(videoId) ? videoId : null;
      }

      // youtube.com/watch?v=VIDEO_ID
      const watchId = urlObj.searchParams.get('v');
      if (watchId) {
        return this.validateVideoId(watchId) ? watchId : null;
      }

      // youtube.com/shorts/VIDEO_ID
      const shortsMatch = urlObj.pathname.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
      return shortsMatch?.[1] ?? null;
    } catch {
      return null;
    }
  }

  normalizeUrl(url: string): string | null {
    const videoId = this.extractVideoId(url);
    if (!videoId) return null;
    return `https://www.youtube.com/watch?v=${videoId}`;
  }

  capabilities(): ProviderCapabilities {
    return {
      supportsMetadata: true,
      supportsTranscript: true,
      supportsNativeTranscript: true,
      supportsFallbackTranscript: true,
    };
  }

  async fetchMetadata(
    videoId: string,
    options: ProviderOptions = {},
  ): Promise<ProviderMetadataResult> {
    const mode = options.mode ?? ProviderMode.REAL;

    if (mode === ProviderMode.MOCK) {
      return {
        metadata: {
          platformVideoId: videoId,
          canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
          title: `YouTube Mock Video ${videoId}`,
          description: 'This is a deterministic mock metadata payload.',
          creatorName: 'Mock Creator',
          creatorHandle: '@mockcreator',
          followerCount: 123000,
          views: 456789,
          likes: 3210,
          comments: 120,
          engagementRate: 0.75,
          durationSeconds: 210,
          hashtags: ['#mock', '#youtube'],
          thumbnailUrl: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
          uploadDate: new Date('2024-01-01T00:00:00.000Z'),
        },
        sourceAttribution: 'MOCK',
        confidence: 1,
      };
    }

    throw new ProviderFeatureUnsupportedError(
      'YouTube real metadata extraction is not implemented yet.',
    );
  }

  async fetchTranscript(
    videoId: string,
    options: ProviderOptions = {},
  ): Promise<TranscriptResult | null> {
    const mode = options.mode ?? ProviderMode.REAL;

    if (mode === ProviderMode.MOCK) {
      return {
        segments: [
          {
            sequenceIndex: 0,
            startSeconds: 0,
            endSeconds: 5,
            text: 'This is a mock transcript segment for YouTube.',
            sourceType: 'NATIVE',
          },
        ],
        duration: 210,
        language: 'en',
        hasNativeTranscript: true,
        status: 'AVAILABLE',
        sourceAttribution: 'MOCK',
        confidence: 0.9,
      };
    }

    throw new ProviderFeatureUnsupportedError(
      'YouTube real transcript extraction is not implemented yet.',
    );
  }

  async fetchVideo(videoId: string, options: ProviderOptions = {}): Promise<ProviderAdapterResult> {
    const metadata = await this.fetchMetadata(videoId, options);
    const transcript = await this.fetchTranscript(videoId, options);

    return {
      metadata,
      transcript,
    };
  }

  private validateVideoId(videoId: string): boolean {
    return this.videoIdRegex.test(videoId);
  }

  getProvider(): VideoProvider {
    return VideoProvider.YOUTUBE;
  }
}
