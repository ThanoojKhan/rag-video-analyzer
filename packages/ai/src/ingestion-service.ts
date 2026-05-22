import { randomUUID } from 'node:crypto';
import { Video, IngestionJob } from '@prisma/client';
import { prisma } from '@rag/db';
import { URLValidator, URLValidationError, ProviderRegistry, ProviderMode } from '@rag/providers';
import { TranscriptPipeline } from './transcript-pipeline.js';
import { ChunkingService } from './chunking-service.js';

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
  refreshMetadata?: boolean;
  skipTranscript?: boolean;
}

interface Logger {
  info(msg: string, meta?: unknown): void;
  warn(msg: string, meta?: unknown): void;
  error(msg: string, meta?: unknown): void;
  debug(msg: string, meta?: unknown): void;
}

const noOpLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

export interface IngestResult {
  video: Video;
  ingestionJob?: IngestionJob;
  isNew: boolean;
  durationMs: number;
}

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

    let canonicalUrl: string;
    let providerName: string;

    try {
      const normalized = URLValidator.normalize(url);
      canonicalUrl = normalized.canonicalUrl;
      providerName = normalized.provider;
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

    const existingVideo = await prisma.video.findUnique({
      where: { canonicalUrl },
      include: { transcriptSegments: true },
    });

    if (existingVideo && !options.refreshMetadata && existingVideo.ingestionStatus !== 'FAILED') {
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
      this.logger.info('Video exists - refreshing metadata', { videoId: existingVideo.id });
    }

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
      let metadataResult;
      try {
        this.logger.debug('Fetching metadata', {
          requestId,
          videoId,
          provider: providerName,
        });

        metadataResult = await provider.fetchMetadata(videoId);

        this.logger.info('Metadata fetched successfully', {
          requestId,
          videoId,
          title: metadataResult.metadata.title,
          duration: metadataResult.metadata.durationSeconds,
          views: metadataResult.metadata.views,
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

      const metadata = metadataResult.metadata;

      let transcript = null;
      if (!options.skipTranscript) {
        try {
          const hasGoogle = Boolean(process.env.GOOGLE_API_KEY);
          const mode = hasGoogle ? ProviderMode.REAL : ProviderMode.MOCK;
          transcript = await provider.fetchTranscript(videoId, { mode });

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

      const engagementRate = this.calculateEngagementRate({
        likes: metadata.likes,
        comments: metadata.comments,
        views: metadata.views,
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
          followerCount: metadata.followerCount ?? 0,
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
        update:
          options.refreshMetadata || !existingVideo
            ? {
                title: metadata.title,
                description: metadata.description,
                creatorName: metadata.creatorName,
                creatorHandle: metadata.creatorHandle,
                followerCount: metadata.followerCount ?? 0,
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

      if (transcript && transcript.segments.length > 0) {
        await prisma.transcriptSegment.deleteMany({
          where: { videoId: updatedVideo.id },
        });

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

        await ChunkingService.createChunksForVideo(updatedVideo.id, ingestionJob.id);
        this.logger.info('Transcript chunks generated', {
          videoId: updatedVideo.id,
          segments: transcript.segments.length,
        });
      } else {
        this.logger.info(
          'No transcript available, skipping chunking and marking embedding as complete',
          {
            requestId,
            videoId: updatedVideo.id,
          },
        );
        await prisma.videoEmbeddingState.upsert({
          where: { videoId: updatedVideo.id },
          update: {
            ingestionJobId: ingestionJob.id,
            status: 'COMPLETED',
            model: 'Xenova/bge-small-en-v1.5',
            chunkCount: 0,
            errorMessage: 'No transcript available',
          },
          create: {
            videoId: updatedVideo.id,
            ingestionJobId: ingestionJob.id,
            status: 'COMPLETED',
            model: 'Xenova/bge-small-en-v1.5',
            chunkCount: 0,
            errorMessage: 'No transcript available',
          },
        });
      }

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

      if (ingestionJob.videoId) {
        await prisma.video.update({
          where: { id: ingestionJob.videoId },
          data: {
            ingestionStatus: 'FAILED',
            title: existingVideo ? undefined : 'Failed Ingestion',
          },
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

    return this.ingestFromUrl(video.canonicalUrl, {
      refreshMetadata: true,
    });
  }

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
