import { vi, describe, it, expect, beforeEach } from 'vitest';
import { EmbeddingService, generateDeterministicMockVector } from './embedding-service.js';
import { prisma } from '@rag/db';

vi.mock('@rag/db', () => {
  return {
    prisma: {
      videoEmbeddingState: {
        updateMany: vi.fn(),
        update: vi.fn(),
      },
      retrievalChunk: {
        findMany: vi.fn(),
      },
      $transaction: vi.fn((cb) => cb(prisma)),
      $executeRawUnsafe: vi.fn(),
    },
  };
});

describe('EmbeddingService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Deterministic Mock Vector Generator', () => {
    it('should generate a 384-dimension normalized vector', () => {
      const text = 'Hello, world!';
      const vector = generateDeterministicMockVector(text);
      expect(vector).toHaveLength(384);

      // Verify L2 norm is approximately 1.0 (normalized)
      const norm = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
      expect(norm).toBeCloseTo(1.0, 5);
    });

    it('should be deterministic (same input produces same output)', () => {
      const text = 'Consistent string';
      const vector1 = generateDeterministicMockVector(text);
      const vector2 = generateDeterministicMockVector(text);
      expect(vector1).toEqual(vector2);
    });

    it('should generate different vectors for different strings', () => {
      const vector1 = generateDeterministicMockVector('String One');
      const vector2 = generateDeterministicMockVector('String Two');
      expect(vector1).not.toEqual(vector2);
    });
  });

  describe('generateEmbeddings', () => {
    it('should fallback to mock vectors when apiKey is absent', async () => {
      const service = new EmbeddingService(); // No key
      const texts = ['Text A', 'Text B'];
      const result = await service.generateEmbeddings(texts);
      expect(result).toHaveLength(2);
      expect(result[0]).toHaveLength(384);
      expect(result[1]).toHaveLength(384);
    });

    it('should call fetch and batch texts when apiKey is present', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { index: 0, embedding: new Array(384).fill(0.1) },
            { index: 1, embedding: new Array(384).fill(0.2) },
          ],
        }),
      });
      global.fetch = fetchMock;

      const service = new EmbeddingService(undefined, 'mock-api-key');
      const texts = ['Text A', 'Text B'];
      const result = await service.generateEmbeddings(texts);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(2);
      expect(result[0][0]).toBe(0.1);
      expect(result[1][0]).toBe(0.2);
    });

    it('should retry on failure with backoff', async () => {
      let callCount = 0;
      const fetchMock = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount < 2) {
          return { ok: false, status: 500, text: async () => 'Internal Error' };
        }
        return {
          ok: true,
          json: async () => ({
            data: [{ index: 0, embedding: new Array(384).fill(0.5) }],
          }),
        };
      });
      global.fetch = fetchMock;

      const service = new EmbeddingService(undefined, 'mock-api-key');
      const result = await service.generateEmbeddings(['Retry Text'], 2);

      expect(callCount).toBe(2);
      expect(result).toHaveLength(1);
      expect(result[0][0]).toBe(0.5);
    });
  });

  describe('processVideoEmbeddings (idempotent pipeline & lifecycle)', () => {
    it('should skip processing if video is already locked (atomic lock fails)', async () => {
      // updateMany returns count: 0 (lock fail)
      vi.mocked(prisma.videoEmbeddingState.updateMany).mockResolvedValue({ count: 0 });

      const service = new EmbeddingService();
      await service.processVideoEmbeddings('video-1');

      expect(prisma.videoEmbeddingState.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            videoId: 'video-1',
            status: { in: ['PENDING', 'FAILED'] },
          },
        }),
      );
      expect(prisma.retrievalChunk.findMany).not.toHaveBeenCalled();
    });

    it('should successfully generate embeddings and transition to COMPLETED', async () => {
      // updateMany returns count: 1 (lock success)
      vi.mocked(prisma.videoEmbeddingState.updateMany).mockResolvedValue({ count: 1 });

      const mockChunks = [
        { id: 'chunk-1', videoId: 'video-1', chunkIndex: 0, text: 'Hello' },
        { id: 'chunk-2', videoId: 'video-1', chunkIndex: 1, text: 'World' },
      ];
      vi.mocked(prisma.retrievalChunk.findMany).mockResolvedValue(mockChunks as unknown as never);

      const service = new EmbeddingService();
      await service.processVideoEmbeddings('video-1');

      // Check database vector updates
      expect(prisma.$executeRawUnsafe).toHaveBeenCalledTimes(2);

      // Check final state updated to COMPLETED
      expect(prisma.videoEmbeddingState.update).toHaveBeenCalledWith({
        where: { videoId: 'video-1' },
        data: expect.objectContaining({
          status: 'COMPLETED',
          embeddingProvider: 'mock',
          vectorDimensions: 384,
        }),
      });
    });

    it('should transition to FAILED and rethrow if generation fails', async () => {
      vi.mocked(prisma.videoEmbeddingState.updateMany).mockResolvedValue({ count: 1 });
      vi.mocked(prisma.retrievalChunk.findMany).mockRejectedValue(new Error('DB Error'));

      const service = new EmbeddingService();
      await expect(service.processVideoEmbeddings('video-1')).rejects.toThrow('DB Error');

      // Check state transitioned to FAILED
      expect(prisma.videoEmbeddingState.update).toHaveBeenCalledWith({
        where: { videoId: 'video-1' },
        data: expect.objectContaining({
          status: 'FAILED',
          errorMessage: 'DB Error',
        }),
      });
    });
  });
});
