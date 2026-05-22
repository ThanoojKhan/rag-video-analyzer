import { prisma } from '@rag/db';
import { chunkingConfigSchema, type ChunkingConfig } from '@rag/shared';

export interface SegmentInput {
  sequenceIndex: number;
  startSeconds: number;
  endSeconds: number;
  text: string;
}

export interface PendingChunk {
  chunkIndex: number;
  text: string;
  tokenCount: number;
  startSeconds: number;
  endSeconds: number;
  transcriptSegmentStart: number;
  transcriptSegmentEnd: number;
  segments: SegmentInput[];
}

export class ChunkingService {
  /**
   * Estimates token count based on standard English words-to-tokens ratio (~1.3 tokens/word)
   */
  static estimateTokenCount(text: string): number {
    if (!text || text.trim() === '') return 0;
    const words = text.trim().split(/\s+/);
    return Math.ceil(words.length * 1.3);
  }

  /**
   * Helper to get overlap segments from the end of a finalized chunk's segments list
   */
  private static getOverlapSegments(
    prevSegments: SegmentInput[],
    overlapTokens: number,
    maxTokens: number,
  ): SegmentInput[] {
    const targetOverlap = Math.min(overlapTokens, Math.floor(maxTokens * 0.5));
    if (targetOverlap <= 0 || prevSegments.length === 0) {
      return [];
    }

    const overlap: SegmentInput[] = [];
    let currentTokens = 0;

    for (let i = prevSegments.length - 1; i >= 0; i--) {
      const seg = prevSegments[i];
      if (!seg) continue;
      const tokens = ChunkingService.estimateTokenCount(seg.text);
      if (currentTokens + tokens <= targetOverlap) {
        overlap.unshift(seg);
        currentTokens += tokens;
      } else {
        if (overlap.length === 0 && tokens < maxTokens) {
          overlap.unshift(seg);
        }
        break;
      }
    }
    return overlap;
  }

  static chunkTranscript(
    segments: SegmentInput[],
    options?: Partial<ChunkingConfig>,
    logger?: {
      info: (msg: string, meta?: unknown) => void;
      debug: (msg: string, meta?: unknown) => void;
    },
  ): PendingChunk[] {
    logger?.info('Starting transcript chunking', { segmentCount: segments.length });
    const config = chunkingConfigSchema.parse({
      ...chunkingConfigSchema.parse({}), // default values
      ...options,
    });

    const { maxTokens, overlapTokens, minChunkSize, timeGapThresholdSeconds } = config;

    const sortedSegments = [...segments]
      .filter((s): s is SegmentInput => !!s)
      .sort((a, b) => a.sequenceIndex - b.sequenceIndex);

    const chunks: PendingChunk[] = [];
    let chunkIndex = 0;

    const finalizeChunk = (bufferSegments: SegmentInput[], reason: string): void => {
      if (bufferSegments.length === 0) return;
      const firstSeg = bufferSegments[0];
      const lastSeg = bufferSegments[bufferSegments.length - 1];
      if (!firstSeg || !lastSeg) return;

      const text = bufferSegments.map((s) => (s?.text || '').trim()).join(' ');
      const tokens = ChunkingService.estimateTokenCount(text);
      const start = firstSeg.startSeconds;
      const end = lastSeg.endSeconds;
      const startSeg = firstSeg.sequenceIndex;
      const endSeg = lastSeg.sequenceIndex;

      logger?.debug('Finalizing retrieval chunk', {
        chunkIndex,
        reason,
        tokenCount: tokens,
        startSeconds: start,
        endSeconds: end,
        segmentRange: [startSeg, endSeg],
      });

      chunks.push({
        chunkIndex: chunkIndex++,
        text,
        tokenCount: tokens,
        startSeconds: start,
        endSeconds: end,
        transcriptSegmentStart: startSeg,
        transcriptSegmentEnd: endSeg,
        segments: [...bufferSegments],
      });
    };

    let buffer: SegmentInput[] = [];

    for (let i = 0; i < sortedSegments.length; i++) {
      const seg = sortedSegments[i];
      if (!seg) continue;

      if (buffer.length === 0) {
        buffer.push(seg);
        continue;
      }

      const lastSeg = buffer[buffer.length - 1];
      if (!lastSeg) {
        buffer.push(seg);
        continue;
      }

      const gap = seg.startSeconds - lastSeg.endSeconds;
      const hasTimeGap = gap > timeGapThresholdSeconds;
      const hasSentenceEnd = /[.!?]$/.test(lastSeg.text.trim());

      const currentText = buffer.map((s) => (s?.text || '').trim()).join(' ');
      const currentTokens = ChunkingService.estimateTokenCount(currentText);

      if ((hasTimeGap || hasSentenceEnd) && currentTokens >= minChunkSize) {
        const splitReason = hasTimeGap
          ? `time gap boundary (${gap.toFixed(1)}s > ${timeGapThresholdSeconds}s)`
          : 'sentence end boundary';

        finalizeChunk(buffer, `split decision: ${splitReason}`);

        const overlap = ChunkingService.getOverlapSegments(buffer, overlapTokens, maxTokens);
        buffer = [...overlap, seg];

        while (
          buffer.length > 1 &&
          ChunkingService.estimateTokenCount(buffer.map((s) => (s?.text || '').trim()).join(' ')) >
            maxTokens
        ) {
          buffer.shift();
        }
        continue;
      }

      const candidateText = [...buffer, seg].map((s) => (s?.text || '').trim()).join(' ');
      const candidateTokens = ChunkingService.estimateTokenCount(candidateText);

      if (candidateTokens > maxTokens) {
        finalizeChunk(
          buffer,
          `split decision: candidate tokens (${candidateTokens}) exceed maxTokens (${maxTokens})`,
        );

        const overlap = ChunkingService.getOverlapSegments(buffer, overlapTokens, maxTokens);
        buffer = [...overlap, seg];

        while (
          buffer.length > 1 &&
          ChunkingService.estimateTokenCount(buffer.map((s) => (s?.text || '').trim()).join(' ')) >
            maxTokens
        ) {
          buffer.shift();
        }
      } else {
        buffer.push(seg);
      }
    }

    if (buffer.length > 0) {
      const lastFinalized = chunks[chunks.length - 1];
      const lastBufferSeg = buffer[buffer.length - 1];
      const hasNewContent =
        !lastFinalized ||
        (lastBufferSeg && lastBufferSeg.sequenceIndex > lastFinalized.transcriptSegmentEnd);

      if (hasNewContent) {
        finalizeChunk(buffer, 'remaining buffer cleanup');
      }
    }

    logger?.info('Completed transcript chunking', { totalChunks: chunks.length });
    return chunks;
  }

  static async createChunksForVideo(
    videoId: string,
    ingestionJobId: string,
    options?: Partial<ChunkingConfig>,
    embeddingModel: string = 'Xenova/bge-small-en-v1.5',
    logger?: {
      info: (msg: string, meta?: unknown) => void;
      debug: (msg: string, meta?: unknown) => void;
    },
  ): Promise<void> {
    logger?.info('Starting createChunksForVideo', { videoId, ingestionJobId });

    const video = await prisma.video.findUnique({
      where: { id: videoId },
      include: {
        transcriptSegments: {
          orderBy: { sequenceIndex: 'asc' },
        },
      },
    });

    if (!video) {
      throw new Error(`Video not found: ${videoId}`);
    }

    if (video.transcriptSegments.length === 0) {
      throw new Error(`No transcript segments found for video: ${videoId}`);
    }

    const segmentsInput: SegmentInput[] = video.transcriptSegments.map((seg) => ({
      sequenceIndex: seg.sequenceIndex,
      startSeconds: seg.startSeconds,
      endSeconds: seg.endSeconds,
      text: seg.text,
    }));

    const pendingChunks = ChunkingService.chunkTranscript(segmentsInput, options, logger);

    await prisma.$transaction(async (tx) => {
      await tx.retrievalChunk.deleteMany({
        where: { videoId },
      });

      const metadataSource = video.platform;
      const transcriptSource = video.transcriptSegments[0]?.sourceType || 'NATIVE';

      for (const chunk of pendingChunks) {
        await tx.retrievalChunk.create({
          data: {
            videoId,
            ingestionJobId,
            chunkIndex: chunk.chunkIndex,
            text: chunk.text,
            tokenCount: chunk.tokenCount,
            startSeconds: chunk.startSeconds,
            endSeconds: chunk.endSeconds,
            transcriptSegmentStart: chunk.transcriptSegmentStart,
            transcriptSegmentEnd: chunk.transcriptSegmentEnd,
            embeddingModel,
            metadataSource,
            transcriptSource,
          },
        });
      }

      await tx.videoEmbeddingState.upsert({
        where: { videoId },
        update: {
          ingestionJobId,
          status: 'PENDING',
          model: embeddingModel,
          chunkCount: pendingChunks.length,
          errorMessage: null,
        },
        create: {
          videoId,
          ingestionJobId,
          status: 'PENDING',
          model: embeddingModel,
          chunkCount: pendingChunks.length,
        },
      });
    });
    logger?.info('Completed createChunksForVideo successfully');
  }
}
