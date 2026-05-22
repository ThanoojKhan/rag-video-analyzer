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
import ytDlp from 'yt-dlp-exec';
import { LocalWhisperTranscriber } from '../../services/whisper-transcriber.js';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';

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

    try {
      const url = `https://www.instagram.com/reel/${videoId}/`;

      interface YtDlpInfo {
        title?: string;
        description?: string;
        uploader?: string;
        uploader_id?: string;
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
          title: info.title || 'Instagram Reel',
          description: info.description || null,
          creatorName: info.uploader || null,
          creatorHandle: info.uploader_id ? `@${info.uploader_id}` : null,
          followerCount: null,
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
        sourceAttribution: 'YT_DLP',
        confidence: 0.9,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      throw new ProviderError(
        `[INSTAGRAM_METADATA_ERROR] Failed to extract Instagram metadata: ${errorMsg}`,
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

    const tmpDir = os.tmpdir();
    const outputAudioPath = path.join(tmpDir, `${videoId}.wav`);

    try {
      const url = `https://www.instagram.com/reel/${videoId}/`;

      // Download audio
      await ytDlp(url, {
        extractAudio: true,
        audioFormat: 'wav',
        output: outputAudioPath,
        noWarnings: true,
        noCheckCertificate: true,
      });

      // Transcribe via Whisper
      const segmentsRaw = await LocalWhisperTranscriber.transcribeAudioFile(outputAudioPath);

      const segments = segmentsRaw.map((s, idx) => ({
        sequenceIndex: idx,
        startSeconds: s.start,
        endSeconds: s.end,
        text: s.text,
        sourceType: 'EXTRACTED' as const,
      }));

      const duration = segments.length > 0 ? segments[segments.length - 1]!.endSeconds : 0;

      return {
        segments,
        duration,
        language: 'en',
        hasNativeTranscript: false,
        status: 'AVAILABLE',
        sourceAttribution: 'WHISPER',
        confidence: 0.85,
      };
    } catch (err) {
      return {
        segments: [],
        duration: 0,
        language: 'en',
        hasNativeTranscript: false,
        status: 'UNAVAILABLE',
        sourceAttribution: 'WHISPER',
        confidence: 0,
      };
    } finally {
      // Clean up the temp audio file
      try {
        await fs.unlink(outputAudioPath);
      } catch (e) {
        // ignore deletion errors if file doesn't exist
      }
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

  getProvider(): VideoProvider {
    return VideoProvider.INSTAGRAM;
  }
}
