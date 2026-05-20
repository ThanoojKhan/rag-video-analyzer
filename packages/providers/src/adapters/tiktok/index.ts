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
 * TikTok video provider adapter.
 *
 * Supports:
 * - tiktok.com/@USER/video/VIDEO_ID
 * - vm.tiktok.com/SHORT_CODE (short links)
 * - vt.tiktok.com/SHORT_CODE
 */
export class TikTokProvider implements IVideoProvider {
  canHandle(url: string): boolean {
    try {
      const urlObj = new URL(url);
      return (
        urlObj.hostname.includes('tiktok.com') ||
        urlObj.hostname.includes('vm.tiktok.com') ||
        urlObj.hostname.includes('vt.tiktok.com')
      );
    } catch {
      return false;
    }
  }

  extractVideoId(url: string): string | null {
    try {
      const urlObj = new URL(url);

      // tiktok.com/@USER/video/VIDEO_ID
      const match = urlObj.pathname.match(/\/video\/(\d+)/);
      if (match) {
        return match[1] ?? null;
      }

      // Short links (vm.tiktok.com/SHORT_CODE) - extract from URL
      if (urlObj.hostname.includes('vm.tiktok.com') || urlObj.hostname.includes('vt.tiktok.com')) {
        return urlObj.pathname.slice(1);
      }

      return null;
    } catch {
      return null;
    }
  }

  normalizeUrl(url: string): string | null {
    const videoId = this.extractVideoId(url);
    if (!videoId) return null;
    // Note: TikTok short links may be preferred in practice
    return `https://www.tiktok.com/video/${videoId}`;
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
          canonicalUrl: `https://www.tiktok.com/video/${videoId}`,
          title: `TikTok Mock Video ${videoId}`,
          description: 'Deterministic mock metadata for TikTok.',
          creatorName: 'Mock Creator',
          creatorHandle: '@mockcreator',
          followerCount: 91000,
          views: 134500,
          likes: 8900,
          comments: 270,
          engagementRate: 1.02,
          durationSeconds: 22,
          hashtags: ['#mock', '#tiktok'],
          thumbnailUrl: `https://www.tiktok.com/${videoId}/thumbnail.jpg`,
          uploadDate: new Date('2024-03-01T00:00:00.000Z'),
        },
        sourceAttribution: 'MOCK',
        confidence: 1,
      };
    }

    throw new ProviderFeatureUnsupportedError(
      'TikTok real metadata extraction is not implemented yet.',
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
            endSeconds: 3,
            text: 'This is a mock transcript segment for TikTok.',
            sourceType: 'EXTRACTED',
          },
        ],
        duration: 22,
        language: 'en',
        hasNativeTranscript: false,
        status: 'AVAILABLE',
        sourceAttribution: 'MOCK',
        confidence: 0.7,
      };
    }

    throw new ProviderFeatureUnsupportedError(
      'TikTok real transcript extraction is not implemented yet.',
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
    return VideoProvider.TIKTOK;
  }
}
