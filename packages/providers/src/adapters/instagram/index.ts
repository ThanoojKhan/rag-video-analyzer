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
 * Instagram video provider adapter.
 *
 * Supports:
 * - instagram.com/p/POST_ID (Reels, Posts)
 * - instagram.com/reel/REEL_ID
 */
export class InstagramProvider implements IVideoProvider {
  canHandle(url: string): boolean {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.includes('instagram.com') || urlObj.hostname.includes('instagra.me');
    } catch {
      return false;
    }
  }

  extractVideoId(url: string): string | null {
    try {
      const urlObj = new URL(url);

      // instagram.com/p/POST_ID or instagram.com/reel/REEL_ID
      const match = urlObj.pathname.match(/\/(p|reel)\/([a-zA-Z0-9_-]+)/);
      return match?.[2] ?? null;
    } catch {
      return null;
    }
  }

  normalizeUrl(url: string): string | null {
    const videoId = this.extractVideoId(url);
    if (!videoId) return null;
    return `https://www.instagram.com/p/${videoId}/`;
  }

  capabilities(): ProviderCapabilities {
    return {
      supportsMetadata: true,
      supportsTranscript: true,
      supportsNativeTranscript: false,
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
          canonicalUrl: `https://www.instagram.com/p/${videoId}/`,
          title: `Instagram Mock Video ${videoId}`,
          description: 'Deterministic mock metadata for Instagram.',
          creatorName: 'Mock Influencer',
          creatorHandle: '@mockinfluencer',
          followerCount: 78000,
          views: 22100,
          likes: 3100,
          comments: 180,
          engagementRate: 1.52,
          durationSeconds: 34,
          hashtags: ['#mock', '#instagram'],
          thumbnailUrl: `https://instagram.com/p/${videoId}/media/?size=l`,
          uploadDate: new Date('2024-02-01T00:00:00.000Z'),
        },
        sourceAttribution: 'MOCK',
        confidence: 1,
      };
    }

    throw new ProviderFeatureUnsupportedError(
      'Instagram real metadata extraction is not implemented yet.',
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
            endSeconds: 4,
            text: 'This is a mock transcript segment for Instagram.',
            sourceType: 'EXTRACTED',
          },
        ],
        duration: 34,
        language: 'en',
        hasNativeTranscript: false,
        status: 'AVAILABLE',
        sourceAttribution: 'MOCK',
        confidence: 0.75,
      };
    }

    throw new ProviderFeatureUnsupportedError(
      'Instagram real transcript extraction is not implemented yet.',
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

  getProvider(): VideoProvider {
    return VideoProvider.INSTAGRAM;
  }
}
