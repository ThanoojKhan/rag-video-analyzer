import { prisma } from '@rag/db';
import { ProviderHealthTracker, ProviderTransientError } from '@rag/shared';
import { EmbeddingStatus } from '@prisma/client';

import { pipeline, type FeatureExtractionPipeline } from '@xenova/transformers';

export interface EmbeddingLogger {
  info(msg: string, meta?: unknown): void;
  warn(msg: string, meta?: unknown): void;
  error(msg: string, meta?: unknown): void;
  debug(msg: string, meta?: unknown): void;
}

const noOpLogger: EmbeddingLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

/**
 * Generates a deterministic normalized mock vector for a given text.
 * The output vector has 384 dimensions and magnitude 1.0.
 */
export function generateDeterministicMockVector(text: string, dimensions = 384): number[] {
  const vector: number[] = new Array(dimensions).fill(0);
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0; // Convert to 32bit integer
  }

  for (let i = 0; i < dimensions; i++) {
    const val = Math.sin(hash + i) * 10000;
    vector[i] = val - Math.floor(val);
  }
  const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
  if (magnitude > 0) {
    for (let i = 0; i < dimensions; i++) {
      vector[i] = vector[i]! / magnitude;
    }
  } else {
    vector[0] = 1.0;
  }

  return vector;
}

export class EmbeddingService {
  private logger: EmbeddingLogger;
  private pipelinePromise: Promise<FeatureExtractionPipeline> | null = null;
  private isMockMode: boolean;

  constructor(logger?: EmbeddingLogger, apiKey?: string) {
    this.logger = logger || noOpLogger;
    this.isMockMode = Boolean(apiKey) === false && process.env.NODE_ENV !== 'production';

    if (!this.isMockMode) {
      this.logger.info(
        '[EmbeddingService] Initializing local BGE embeddings (Xenova/bge-small-en-v1.5)',
      );
      this.pipelinePromise = pipeline('feature-extraction', 'Xenova/bge-small-en-v1.5', {
        quantized: true,
      });
    }
  }

  private async fetchLocalEmbedding(texts: string[]): Promise<number[][]> {
    if (!this.pipelinePromise) {
      throw new Error('EmbeddingService: Pipeline not initialized.');
    }
    const extractor = await this.pipelinePromise;
    try {
      const output = await extractor(texts, { pooling: 'mean', normalize: true });
      return output.tolist();
    } catch (err) {
      const typedError = new ProviderTransientError();
      ProviderHealthTracker.reportError(typedError);
      throw typedError;
    }
  }

  /**
   * Generates embeddings for a list of texts, with batching and retry handling.
   * If videoId is provided, updates chunksProcessed in the database.
   */
  async generateEmbeddings(texts: string[], maxRetries = 3, videoId?: string): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    const batchSize = 500;
    const allVectors: number[][] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      this.logger.info('Generating embedding batch', {
        batchIndex: Math.floor(i / batchSize),
        batchSize: batch.length,
        totalTexts: texts.length,
        providerSelection: this.isMockMode ? 'mock' : 'bge-small-local',
      });

      let attempt = 0;
      let success = false;
      let vectors: number[][] = [];
      let lastError: Error | null = null;

      while (attempt < maxRetries && !success) {
        try {
          if (this.isMockMode) {
            vectors = batch.map((text) => generateDeterministicMockVector(text, 384));
          } else {
            vectors = await this.fetchLocalEmbedding(batch);
          }
          success = true;
          this.logger.debug('Successfully retrieved embedding batch', {
            batchSize: batch.length,
          });
        } catch (err) {
          attempt++;
          lastError = err as Error;
          this.logger.warn(`Embedding fetch failed (attempt ${attempt}/${maxRetries})`, {
            error: lastError.message,
          });
          if (attempt < maxRetries) {
            const delay = Math.pow(2, attempt) * 1000 + Math.random() * 200;
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }
      }

      if (!success) {
        throw lastError || new Error(`Failed to generate embeddings after ${maxRetries} attempts`);
      }

      allVectors.push(...vectors);

      if (videoId) {
        await prisma.videoEmbeddingState.update({
          where: { videoId },
          data: { chunksProcessed: { increment: batch.length } },
        });
      }
    }

    return allVectors;
  }

  async generateQueryEmbedding(text: string): Promise<number[]> {
    const embeddings = await this.generateEmbeddings([text]);
    if (embeddings.length === 0 || !embeddings[0]) {
      throw new Error('Failed to generate query embedding');
    }
    return embeddings[0];
  }

  public getProviderName(): string {
    return this.isMockMode ? 'mock' : 'bge-small-local';
  }

  public getModelName(): string {
    return this.isMockMode ? 'deterministic-hash' : 'Xenova/bge-small-en-v1.5';
  }

  /**
   * Idempotently processes all pending chunks of a video, managing states.
   * Leverages atomic lock checks to prevent double-processing.
   */
  async processVideoEmbeddings(videoId: string): Promise<void> {
    this.logger.info('Starting embedding generation processing for video', { videoId });

    // Atomic lock: transition status to PROCESSING only if currently PENDING or FAILED
    const lockResult = await prisma.videoEmbeddingState.updateMany({
      where: {
        videoId,
        status: { in: ['PENDING', 'FAILED'] as EmbeddingStatus[] },
      },
      data: {
        status: 'PROCESSING',
        updatedAt: new Date(),
      },
    });

    if (lockResult.count === 0) {
      this.logger.info('Video embedding job is already PROCESSING or COMPLETED. Skipping.', {
        videoId,
      });
      return;
    }

    try {
      const chunks = await prisma.retrievalChunk.findMany({
        where: { videoId },
        orderBy: { chunkIndex: 'asc' },
      });

      if (chunks.length === 0) {
        this.logger.warn('No chunks found for video to embed; marking as completed', { videoId });
        await prisma.videoEmbeddingState.update({
          where: { videoId },
          data: {
            status: 'COMPLETED',
            embeddingProvider: this.getProviderName(),
            embeddingVersion: this.getModelName(),
            vectorDimensions: 384,
            embeddingGeneratedAt: new Date(),
            errorMessage: null,
            updatedAt: new Date(),
          },
        });
        return;
      }

      const texts = chunks.map((c) => c.text);
      this.logger.info(`Generating embeddings for ${chunks.length} chunks`, { videoId });

      await prisma.videoEmbeddingState.update({
        where: { videoId },
        data: { chunkCount: chunks.length, chunksProcessed: 0 },
      });

      const embeddings = await this.generateEmbeddings(texts, 3, videoId);

      this.logger.info('Persisting embedding vectors to database', {
        videoId,
        chunkCount: chunks.length,
      });
      await prisma.$transaction(async (tx) => {
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i]!;
          const vector = embeddings[i]!;
          const vectorStr = `[${vector.join(',')}]`;

          await tx.$executeRawUnsafe(
            `UPDATE "RetrievalChunk" SET embedding = $1::vector, "embeddingProvider" = $2, "embeddingVersion" = $3, "vectorDimensions" = $4, "embeddingGeneratedAt" = $5 WHERE id = $6`,
            vectorStr,
            this.getProviderName(),
            this.getModelName(),
            384,
            new Date(),
            chunk.id,
          );
        }
      });

      await prisma.videoEmbeddingState.update({
        where: { videoId },
        data: {
          status: 'COMPLETED',
          embeddingProvider: this.getProviderName(),
          embeddingVersion: this.getModelName(),
          vectorDimensions: 384,
          embeddingGeneratedAt: new Date(),
          errorMessage: null,
          updatedAt: new Date(),
        },
      });

      this.logger.info('Embedding generation processing completed successfully', { videoId });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error('Embedding generation processing failed', { videoId, error: errorMsg });

      try {
        await prisma.videoEmbeddingState.update({
          where: { videoId },
          data: {
            status: 'FAILED',
            errorMessage: errorMsg,
            updatedAt: new Date(),
          },
        });
      } catch (updateErr) {
        this.logger.error('Failed to set embedding status to FAILED', {
          videoId,
          error: String(updateErr),
        });
      }

      throw error;
    }
  }
}
