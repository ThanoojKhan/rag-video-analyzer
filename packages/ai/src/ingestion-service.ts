import { randomUUID } from 'node:crypto';
import { prisma } from '@rag/db';
import { URLValidator, URLValidationError, ProviderRegistry } from '@rag/providers';
import { TranscriptPipeline } from './transcript-pipeline.js';

export enum IngestionErrorCode {
  INVALID_URL = 'INVALID_URL',
  UNSUPPORTED_PROVIDER = 'UNSUPPORTED_PROVIDER',
  METADATA_FETCH_FAILED = 'METADATA_FETCH_FAILED',
  TRANSCRIPT_FETCH_FAILED = 'TRANSCRIPT_FETCH_FAILED',
  DATABASE_ERROR = 'DATABASE_ERROR',
  DUPLICATE_VIDEO = 'DUPLICATE_VIDEO',
}

export class IngestionError extends Error {
  constructor(
    public code: IngestionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'IngestionError';
  }
}

interface IngestionOptions {
  /** If true, update metadata even if video exists */
  refreshMetadata?: boolean;
  /** Skip transcript acquisition */
  skipTranscript?: boolean;
}

interface Logger {
  info(msg: string, meta?: unknown): void;
  warn(msg: string, meta?: unknown): void;
  error(msg: string, meta?: unknown): void;
  debug(msg: string, meta?: unknown): void;
}

// No-op logger for when logging is not provided
const noOpLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

interface IngestResult {
  video: unknown;
  ingestionJob?: unknown;
  isNew: boolean;
  durationMs: number;
}

/**
 * Video ingestion service.
 *
 * Responsibilities:
 * - Validate and normalize URLs
 * - Detect providers
 * - Fetch metadata and transcripts
 * - Persist entities
 * - Track ingestion lifecycle
 * - Support idempotent operations
 */
export class IngestionService {
  private transcriptPipeline = new TranscriptPipeline();
  private logger: Logger;

  constructor(logger?: Logger) {
    this.logger = logger || noOpLogger;
  }

  /**
   * Ingest a video from URL.
   *
   * Idempotent: If video already exists, returns existing record.
   * Can optionally refresh metadata with refreshMetadata flag.
   */
  async ingestFromUrl(url: string, options: IngestionOptions = {}): Promise<IngestResult> {
    const startTime = Date.now();
    const requestId = this.generateRequestId();

    this.logger.info('Ingestion started', {
      requestId,
      url: this.sanitizeUrl(url),
      options,
    });

    // Step 1: Validate and normalize URL
    let canonicalUrl: string;
    let providerName: string;

    try {
      this.logger.debug('Validating and normalizing URL', { requestId });
      const normalized = URLValidator.normalize(url);
      canonicalUrl = normalized.canonicalUrl;
      providerName = normalized.provider;

      this.logger.info('URL normalized successfully', {
        requestId,
        provider: providerName,
        canonicalUrl,
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.warn('URL validation failed', {
        requestId,
        error: errorMsg,
      });

      if (error instanceof URLValidationError) {
        const validationMessage = error.message || String(error);
        throw new IngestionError(IngestionErrorCode.INVALID_URL, validationMessage);
      }
      throw new IngestionError(IngestionErrorCode.UNSUPPORTED_PROVIDER, 'Failed to validate URL');
    }

    // Step 2: Check if video already exists (idempotency)
    this.logger.debug('Checking for existing video', {
      requestId,
      canonicalUrl,
    });

    const existingVideo = await prisma.video.findUnique({
      where: { canonicalUrl },
      include: { transcriptSegments: true },
    });

    if (existingVideo && !options.refreshMetadata) {
      this.logger.info('Video already exists - returning cached result', {
        requestId,
        videoId: existingVideo.id,
        platform: existingVideo.platform,
      });

      return {
        video: existingVideo,
        isNew: false,
        durationMs: Date.now() - startTime,
      };
    }

    if (existingVideo) {
      this.logger.info('Video exists - refreshing metadata', {
        requestId,
        videoId: existingVideo.id,
      });
    }

    // Step 3: Get provider adapter
    this.logger.debug('Detecting provider adapter', {
      requestId,
      provider: providerName,
    });

    const provider = ProviderRegistry.detectProvider(url);
    if (!provider) {
      this.logger.error('Provider detection failed', {
        requestId,
        provider: providerName,
      });

      throw new IngestionError(
        IngestionErrorCode.UNSUPPORTED_PROVIDER,
        'Unable to detect provider for URL',
      );
    }

    const videoId = provider.extractVideoId(url);
    if (!videoId) {
      this.logger.error('Video ID extraction failed', {
        requestId,
        provider: providerName,
      });

      throw new IngestionError(
        IngestionErrorCode.INVALID_URL,
        'Failed to extract video ID from URL',
      );
    }

    this.logger.info('Provider detected and video ID extracted', {
      requestId,
      provider: providerName,
      videoId,
    });

    // Step 4: Create or update ingestion job
    let ingestionJob = await prisma.ingestionJob.create({
      data: {
        provider: providerName,
        status: 'PROCESSING',
        video: existingVideo
          ? { connect: { id: existingVideo.id } }
          : {
              create: {
                platform: providerName,
                platformVideoId: videoId,
                canonicalUrl,
                title: 'Pending',
                ingestionStatus: 'PROCESSING',
              },
            },
        startedAt: new Date(),
      },
    });

    this.logger.info('Ingestion job created', {
      requestId,
      jobId: ingestionJob.id,
      videoId: ingestionJob.videoId,
    });

    try {
      // Step 5: Fetch metadata
      let metadata;
      try {
        this.logger.debug('Fetching metadata', {
          requestId,
          videoId,
          provider: providerName,
        });

        metadata = await provider.fetchMetadata(videoId);

        this.logger.info('Metadata fetched successfully', {
          requestId,
          videoId,
          title: metadata.title,
          duration: metadata.durationSeconds,
          views: metadata.views,
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        this.logger.error('Metadata fetch failed', {
          requestId,
          videoId,
          error: errorMsg,
        });

        throw new IngestionError(
          IngestionErrorCode.METADATA_FETCH_FAILED,
          `Failed to fetch metadata: ${errorMsg}`,
        );
      }

      // Step 6: Fetch transcript (unless skipped)
      let transcript = null;
      if (!options.skipTranscript) {
        try {
          this.logger.debug('Acquiring transcript', {
            requestId,
            videoId,
            provider: providerName,
          });

          transcript = await this.transcriptPipeline.acquire(providerName, videoId);

          if (transcript) {
            this.logger.info('Transcript acquired successfully', {
              requestId,
              videoId,
              segmentCount: transcript.segments.length,
              duration: transcript.duration,
              sourceType: transcript.segments[0]?.sourceType,
            });
          } else {
            this.logger.info('No transcript available for video', {
              requestId,
              videoId,
            });
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          this.logger.warn('Transcript acquisition failed', {
            requestId,
            videoId,
            error: errorMsg,
          });
        }
      } else {
        this.logger.debug('Skipping transcript acquisition', {
          requestId,
          videoId,
        });
      }

      // Step 7: Calculate engagement rate
      const engagementRate = this.calculateEngagementRate({
        likes: metadata.likes,
        comments: metadata.comments,
        views: metadata.views,
      });

      this.logger.debug('Engagement rate calculated', {
        requestId,
        videoId,
        engagementRate,
      });

      // Step 8: Update or create video
      this.logger.debug('Persisting video data', {
        requestId,
        videoId,
        isUpdate: !!existingVideo,
        refreshMetadata: options.refreshMetadata,
      });

      const updatedVideo = await prisma.video.upsert({
        where: { canonicalUrl },
        create: {
          platform: providerName,
          platformVideoId: videoId,
          canonicalUrl,
          title: metadata.title,
          description: metadata.description,
          creatorName: metadata.creatorName,
          creatorHandle: metadata.creatorHandle,
          followerCount: metadata.followerCount,
          views: metadata.views,
          likes: metadata.likes,
          comments: metadata.comments,
          engagementRate,
          durationSeconds: metadata.durationSeconds,
          hashtags: metadata.hashtags,
          thumbnailUrl: metadata.thumbnailUrl,
          uploadDate: metadata.uploadDate,
          ingestionStatus: 'PROCESSING',
          lastIngestedAt: new Date(),
        },
        update: options.refreshMetadata
          ? {
              title: metadata.title,
              description: metadata.description,
              creatorName: metadata.creatorName,
              creatorHandle: metadata.creatorHandle,
              followerCount: metadata.followerCount,
              views: metadata.views,
              likes: metadata.likes,
              comments: metadata.comments,
              engagementRate,
              durationSeconds: metadata.durationSeconds,
              hashtags: metadata.hashtags,
              thumbnailUrl: metadata.thumbnailUrl,
              uploadDate: metadata.uploadDate,
              lastIngestedAt: new Date(),
            }
          : { lastIngestedAt: new Date() },
      });

      this.logger.info('Video persisted to database', {
        requestId,
        videoId: updatedVideo.id,
        isNew: !existingVideo,
      });

      // Step 9: Persist transcript segments if available
      if (transcript && transcript.segments.length > 0) {
        this.logger.debug('Persisting transcript segments', {
          requestId,
          videoId: updatedVideo.id,
          segmentCount: transcript.segments.length,
        });

        // Clear existing transcript segments
        await prisma.transcriptSegment.deleteMany({
          where: { videoId: updatedVideo.id },
        });

        // Insert new segments
        await prisma.transcriptSegment.createMany({
          data: transcript.segments.map(
            (seg: {
              sequenceIndex: number;
              startSeconds: number;
              endSeconds: number;
              text: string;
              sourceType: 'NATIVE' | 'EXTRACTED' | 'GENERATED';
            }) => ({
              videoId: updatedVideo.id,
              sequenceIndex: seg.sequenceIndex,
              startSeconds: seg.startSeconds,
              endSeconds: seg.endSeconds,
              text: seg.text,
              sourceType: seg.sourceType,
            }),
          ),
        });

        this.logger.info('Transcript segments persisted', {
          requestId,
          videoId: updatedVideo.id,
          segmentCount: transcript.segments.length,
        });
      }

      // Step 10: Mark ingestion job as completed
      ingestionJob = await prisma.ingestionJob.update({
        where: { id: ingestionJob.id },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
        },
      });

      this.logger.info('Ingestion job completed', {
        requestId,
        jobId: ingestionJob.id,
        duration: Date.now() - startTime,
      });

      // Step 11: Mark video as completed
      const finalVideo = await prisma.video.update({
        where: { id: updatedVideo.id },
        data: { ingestionStatus: 'COMPLETED' },
        include: { transcriptSegments: true },
      });

      this.logger.info('Ingestion completed successfully', {
        requestId,
        videoId: finalVideo.id,
        isNew: !existingVideo,
        durationMs: Date.now() - startTime,
        segmentCount: finalVideo.transcriptSegments.length,
      });

      return {
        video: finalVideo,
        ingestionJob,
        isNew: !existingVideo,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';

      // Mark ingestion job as failed
      await prisma.ingestionJob.update({
        where: { id: ingestionJob.id },
        data: {
          status: 'FAILED',
          failureReason: errorMsg,
          completedAt: new Date(),
        },
      });

      this.logger.error('Ingestion job failed', {
        requestId,
        jobId: ingestionJob.id,
        error: errorMsg,
        duration: Date.now() - startTime,
      });

      // Update video status to failed
      if (ingestionJob.videoId) {
        await prisma.video.update({
          where: { id: ingestionJob.videoId },
          data: { ingestionStatus: 'FAILED' },
        });
      }

      throw error;
    }
  }

  /**
   * Retry failed ingestion for a video.
   */
  async retryIngestion(videoId: string, maxRetries: number = 3): Promise<IngestResult> {
    const video = await prisma.video.findUnique({
      where: { id: videoId },
    });

    if (!video) {
      throw new IngestionError(IngestionErrorCode.DATABASE_ERROR, 'Video not found');
    }

    // Check if already retried too many times
    const failedJobs = await prisma.ingestionJob.count({
      where: {
        videoId,
        status: 'FAILED',
      },
    });

    if (failedJobs >= maxRetries) {
      throw new IngestionError(
        IngestionErrorCode.DATABASE_ERROR,
        `Max retries (${maxRetries}) exceeded`,
      );
    }

    // Retry with canonical URL
    return this.ingestFromUrl(video.canonicalUrl, {
      refreshMetadata: true,
    });
  }

  /**
   * Calculate engagement rate from views, likes, comments.
   */
  private generateRequestId(): string {
    return randomUUID();
  }

  private sanitizeUrl(url: string): string {
    return URLValidator.removeTrackingParams(url);
  }

  private calculateEngagementRate(metrics: {
    views: number;
    likes: number;
    comments: number;
  }): number {
    const { views, likes, comments } = metrics;

    if (views === 0) return 0;

    // Simple engagement rate: (likes + comments) / views * 100
    return ((likes + comments) / views) * 100;
  }
}
