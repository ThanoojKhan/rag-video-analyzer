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
import { ProviderError } from '../../errors.js';
import { YoutubeTranscript } from 'youtube-transcript';
import ytDlp from 'yt-dlp-exec';

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

    try {
      const url = `https://www.youtube.com/watch?v=${videoId}`;

      interface YtDlpInfo {
        title?: string;
        description?: string;
        uploader?: string;
        uploader_id?: string;
        channel_follower_count?: number;
        view_count?: number;
        like_count?: number;
        comment_count?: number;
        duration?: number;
        tags?: string[];
        thumbnail?: string;
        upload_date?: string;
      }

      const info = (await ytDlp(url, {
        dumpSingleJson: true,
        noWarnings: true,
        noCheckCertificate: true,
      })) as YtDlpInfo;

      const views = info.view_count || 0;
      const likes = info.like_count || 0;
      const comments = info.comment_count || 0;

      return {
        metadata: {
          platformVideoId: videoId,
          canonicalUrl: url,
          title: info.title || 'Unknown Title',
          description: info.description || null,
          creatorName: info.uploader || null,
          creatorHandle: info.uploader_id ? `@${info.uploader_id}` : null,
          followerCount: info.channel_follower_count || null,
          views,
          likes,
          comments,
          engagementRate: views > 0 ? ((likes + comments) / views) * 100 : 0,
          durationSeconds: info.duration || 0,
          hashtags: info.tags || [],
          thumbnailUrl: info.thumbnail || null,
          uploadDate: info.upload_date
            ? new Date(info.upload_date.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'))
            : null,
        },
        sourceAttribution: 'YOUTUBE_NATIVE',
        confidence: 1,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      throw new ProviderError(
        `[YOUTUBE_METADATA_ERROR] Failed to extract YouTube metadata: ${errorMsg}`,
      );
    }
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

    try {
      const rawTranscript = await YoutubeTranscript.fetchTranscript(videoId);

      const segments = rawTranscript.map((t, idx) => ({
        sequenceIndex: idx,
        startSeconds: t.offset / 1000,
        endSeconds: (t.offset + t.duration) / 1000,
        text: t.text,
        sourceType: 'NATIVE' as const,
      }));

      const duration = segments.length > 0 ? segments[segments.length - 1]!.endSeconds : 0;

      return {
        segments,
        duration,
        language: 'en',
        hasNativeTranscript: true,
        status: 'AVAILABLE',
        sourceAttribution: 'NATIVE',
        confidence: 1.0,
      };
    } catch (err) {
      // Fallback if no transcript
      return {
        segments: [],
        duration: 0,
        language: 'en',
        hasNativeTranscript: false,
        status: 'UNAVAILABLE',
        sourceAttribution: 'NATIVE',
        confidence: 0,
      };
    }
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
