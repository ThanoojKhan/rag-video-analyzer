import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { IngestionService, IngestionError } from '@rag/ai';
import { prisma } from '@rag/db';

// Request/Response schemas for validation
const ingestRequestSchema = z.object({
  url: z.string().url('Invalid URL format'),
  refreshMetadata: z.boolean().optional(),
  skipTranscript: z.boolean().optional(),
});

const ingestResponseSchema = z.object({
  success: z.boolean(),
  videoId: z.string(),
  isNew: z.boolean(),
  platform: z.string(),
  title: z.string(),
  durationMs: z.number(),
});

const videoResponseSchema = z.object({
  id: z.string(),
  platform: z.string(),
  platformVideoId: z.string(),
  canonicalUrl: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  creatorName: z.string().nullable(),
  creatorHandle: z.string().nullable(),
  followerCount: z.number(),
  views: z.number(),
  likes: z.number(),
  comments: z.number(),
  engagementRate: z.number(),
  durationSeconds: z.number(),
  hashtags: z.array(z.string()),
  thumbnailUrl: z.string().nullable(),
  uploadDate: z.date().nullable(),
  ingestionStatus: z.enum(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'RETRYING']),
  lastIngestedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

const transcriptSegmentSchema = z.object({
  id: z.string(),
  videoId: z.string(),
  sequenceIndex: z.number(),
  startSeconds: z.number(),
  endSeconds: z.number(),
  text: z.string(),
  sourceType: z.enum(['NATIVE', 'EXTRACTED', 'GENERATED']),
  createdAt: z.date(),
});

const ingestionJobSchema = z.object({
  id: z.string(),
  videoId: z.string(),
  provider: z.string(),
  status: z.enum(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'RETRYING']),
  retryCount: z.number(),
  failureReason: z.string().nullable(),
  startedAt: z.date().nullable(),
  completedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

/**
 * Register ingestion API routes.
 */
export async function ingestionRoutes(app: FastifyInstance): Promise<void> {
  const ingestionService = new IngestionService();

  const buildErrorPayload = (
    message: string,
    requestId: string,
    code?: string,
  ): { success: false; error: string; requestId: string; code?: string } => ({
    success: false,
    error: message,
    requestId,
    ...(code ? { code } : {}),
  });

  /**
   * POST /api/v1/videos/ingest
   * Ingest a video from URL.
   */
  app.post<{ Body: z.infer<typeof ingestRequestSchema> }>(
    '/api/v1/videos/ingest',
    {
      schema: {
        body: {
          type: 'object',
          required: ['url'],
          properties: {
            url: { type: 'string', description: 'Video URL' },
            refreshMetadata: {
              type: 'boolean',
              description: 'Force refresh metadata if video exists',
            },
            skipTranscript: {
              type: 'boolean',
              description: 'Skip transcript acquisition',
            },
          },
        },
      },
    },
    async (request, reply) => {
      const requestId = String(request.id);

      try {
        // Validate request
        const validated = ingestRequestSchema.parse(request.body);

        // Ingest video
        const result = await ingestionService.ingestFromUrl(validated.url, {
          refreshMetadata: validated.refreshMetadata,
          skipTranscript: validated.skipTranscript,
        });

        const response = ingestResponseSchema.parse({
          success: true,
          videoId: result.video.id,
          isNew: result.isNew,
          platform: result.video.platform,
          title: result.video.title,
          durationMs: result.durationMs,
        });

        return reply.code(201).send({ ...response, requestId });
      } catch (error) {
        if (error instanceof IngestionError) {
          const statusCode = error.code === 'INVALID_URL' ? 400 : 409;
          return reply
            .code(statusCode)
            .send(buildErrorPayload(error.message, requestId, error.code));
        }

        app.log.error(error instanceof Error ? error : String(error));
        return reply.code(500).send(buildErrorPayload('Internal server error', requestId));
      }
    },
  );

  /**
   * GET /api/v1/videos
   * Get all videos, ordered by most recent.
   */
  app.get('/api/v1/videos', async (request, reply) => {
    const requestId = String(request.id);
    try {
      const videos = await prisma.video.findMany({
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      const validated = z.array(videoResponseSchema).parse(videos);
      return reply.send(validated);
    } catch (error) {
      app.log.error(error instanceof Error ? error : String(error));
      return reply.code(500).send({
        error: 'Internal server error',
        requestId,
      });
    }
  });

  /**
   * GET /api/v1/videos/:id
   * Get video by ID.
   */
  app.get<{ Params: { id: string } }>(
    '/api/v1/videos/:id',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', description: 'Video ID' },
          },
        },
      },
    },
    async (request, reply) => {
      const requestId = String(request.id);

      try {
        const { id } = request.params;

        const video = await prisma.video.findUnique({
          where: { id },
        });

        if (!video) {
          return reply.code(404).send({
            error: 'Video not found',
            requestId,
          });
        }

        const response = videoResponseSchema.parse(video);
        return reply.send(response);
      } catch (error) {
        app.log.error(error instanceof Error ? error : String(error));
        return reply.code(500).send({
          error: 'Internal server error',
          requestId,
        });
      }
    },
  );

  /**
   * GET /api/v1/videos/:id/transcript
   * Get transcript for video.
   */
  app.get<{ Params: { id: string } }>(
    '/api/v1/videos/:id/transcript',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', description: 'Video ID' },
          },
        },
      },
    },
    async (request, reply) => {
      const requestId = String(request.id);

      try {
        const { id } = request.params;

        const segments = await prisma.transcriptSegment.findMany({
          where: { videoId: id },
          orderBy: { sequenceIndex: 'asc' },
        });

        const video = await prisma.video.findUnique({
          where: { id },
          select: { durationSeconds: true },
        });

        if (!video) {
          return reply.code(404).send({
            error: 'Video not found',
            requestId,
          });
        }

        const validated = z.array(transcriptSegmentSchema).parse(segments);

        return reply.send({
          videoId: id,
          segments: validated,
          duration: video.durationSeconds,
          segmentCount: validated.length,
        });
      } catch (error) {
        app.log.error(error instanceof Error ? error : String(error));
        return reply.code(500).send({
          error: 'Internal server error',
          requestId,
        });
      }
    },
  );

  /**
   * GET /api/v1/ingestion-jobs/:id
   * Get ingestion job details.
   */
  app.get<{ Params: { id: string } }>(
    '/api/v1/ingestion-jobs/:id',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', description: 'Ingestion job ID' },
          },
        },
      },
    },
    async (request, reply) => {
      const requestId = String(request.id);

      try {
        const { id } = request.params;

        const job = await prisma.ingestionJob.findUnique({
          where: { id },
        });

        if (!job) {
          return reply.code(404).send({
            error: 'Ingestion job not found',
            requestId,
          });
        }

        const response = ingestionJobSchema.parse(job);
        return reply.send(response);
      } catch (error) {
        app.log.error(error instanceof Error ? error : String(error));
        return reply.code(500).send({
          error: 'Internal server error',
          requestId,
        });
      }
    },
  );
  /**
   * GET /api/v1/videos/:id/status
   * Get the current processing status of a video.
   */
  app.get<{ Params: { id: string } }>(
    '/api/v1/videos/:id/status',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', description: 'Video ID' },
          },
        },
      },
    },
    async (request, reply) => {
      const requestId = String(request.id);

      try {
        const { id } = request.params;

        const video = await prisma.video.findUnique({
          where: { id },
          include: { embeddingState: true },
        });

        if (!video) {
          return reply.code(404).send({
            error: 'Video not found',
            requestId,
          });
        }

        const state = video.embeddingState;
        let progress = 0;

        if (state) {
          if (state.status === 'COMPLETED') {
            progress = 100;
          } else if (state.chunkCount > 0 && state.chunksProcessed > 0) {
            progress = Math.floor((state.chunksProcessed / state.chunkCount) * 100);
          }
        }

        return reply.send({
          videoId: id,
          ingestionStatus: video.ingestionStatus,
          embeddingStatus: state?.status ?? null,
          chunksProcessed: state?.chunksProcessed ?? null,
          totalChunks: state?.chunkCount ?? null,
          overallProgress: progress,
        });
      } catch (error) {
        app.log.error(error instanceof Error ? error : String(error));
        return reply.code(500).send({
          error: 'Internal server error',
          requestId,
        });
      }
    },
  );
}
