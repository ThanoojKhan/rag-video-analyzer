import { vi, describe, it, expect, beforeEach } from 'vitest';
import { RetrievalService, type RetrievalLogger } from './retrieval-service';
import { generateDeterministicMockVector } from './embedding-service.js';
import { prisma } from '@rag/db';

vi.mock('@rag/db', () => {
  return {
    prisma: {
      retrievalChunk: {
        findMany: vi.fn(),
      },
      $queryRawUnsafe: vi.fn(),
    },
  };
});

const mockVideo1 = {
  id: 'video-1',
  title: 'Video One Title',
  canonicalUrl: 'https://youtube.com/watch?v=111',
  creatorName: 'Creator One',
  creatorHandle: 'creator1',
  platform: 'youtube',
  ingestionStatus: 'COMPLETED',
  views: 10000,
};

const mockVideo2 = {
  id: 'video-2',
  title: 'Video Two Title',
  canonicalUrl: 'https://youtube.com/watch?v=222',
  creatorName: 'Creator Two',
  creatorHandle: 'creator2',
  platform: 'youtube',
  ingestionStatus: 'COMPLETED',
  views: 500,
};

const mockChunks = [
  {
    id: 'chunk-1',
    videoId: 'video-1',
    chunkIndex: 0,
    text: 'This is the first segment of Video One about coding algorithms.',
    tokenCount: 15,
    startSeconds: 0.0,
    endSeconds: 10.0,
    transcriptSegmentStart: 0,
    transcriptSegmentEnd: 1,
    transcriptSource: 'NATIVE',
    video: mockVideo1,
  },
  {
    id: 'chunk-2',
    videoId: 'video-1',
    chunkIndex: 1,
    text: 'This is the second segment of Video One focusing on dynamic programming.',
    tokenCount: 20,
    startSeconds: 10.0,
    endSeconds: 25.0,
    transcriptSegmentStart: 2,
    transcriptSegmentEnd: 3,
    transcriptSource: 'NATIVE',
    video: mockVideo1,
  },
  {
    id: 'chunk-3',
    videoId: 'video-2',
    chunkIndex: 0,
    text: 'This is the first segment of Video Two talking about sorting algorithms.',
    tokenCount: 15,
    startSeconds: 0.0,
    endSeconds: 10.0,
    transcriptSegmentStart: 0,
    transcriptSegmentEnd: 1,
    transcriptSource: 'EXTRACTED',
    video: mockVideo2,
  },
];

describe('RetrievalService', () => {
  let mockLogger: RetrievalLogger;

  beforeEach(() => {
    vi.clearAllMocks();

    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };

    vi.mocked(prisma.$queryRawUnsafe).mockImplementation(
      async (sql: string, ...params: unknown[]) => {
        let filtered = [...mockChunks];

        // Scoping: videoId filter
        if (sql.includes('rc."videoId" = $')) {
          // Find parameter mapping to rc."videoId"
          const match = sql.match(/rc\."videoId" = \$(\d+)/);
          if (match) {
            const idx = parseInt(match[1]!) - 1;
            const targetVideoId = params[idx] as string;
            filtered = filtered.filter((c) => c.videoId === targetVideoId);
          }
        }

        // Metadata: platform provider filter
        if (sql.includes('v.platform IN (')) {
          const providers = params.filter(
            (p): p is string =>
              typeof p === 'string' && (p === 'youtube' || p === 'instagram' || p === 'tiktok'),
          );
          if (providers.length > 0) {
            filtered = filtered.filter((c) => providers.includes(c.video.platform));
          }
        }

        // Metadata: transcriptSource filter
        if (sql.includes('rc."transcriptSource" IN (')) {
          const sources = params.filter(
            (p): p is string =>
              typeof p === 'string' && (p === 'NATIVE' || p === 'EXTRACTED' || p === 'GENERATED'),
          );
          if (sources.length > 0) {
            filtered = filtered.filter((c) => sources.includes(c.transcriptSource));
          }
        }

        // Determine query text from vector parameter
        const queryVecStr = params[0] as string;
        let queryText = '';
        if (queryVecStr === `[${generateDeterministicMockVector('algorithms').join(',')}]`) {
          queryText = 'algorithms';
        } else if (queryVecStr === `[${generateDeterministicMockVector('segment').join(',')}]`) {
          queryText = 'segment';
        } else if (
          queryVecStr === `[${generateDeterministicMockVector('dynamic programming').join(',')}]`
        ) {
          queryText = 'dynamic programming';
        } else if (
          queryVecStr ===
          `[${generateDeterministicMockVector('completely-non-existent-word').join(',')}]`
        ) {
          queryText = 'completely-non-existent-word';
        }

        // Map to DBQueryResultRow shape simulating pgvector similarity scores
        let rows = filtered.map((c) => {
          let similarity = 0.1;
          const textLower = c.text.toLowerCase();

          if (queryText && textLower.includes(queryText)) {
            if (queryText === 'dynamic programming') {
              similarity = 0.95;
            } else if (queryText === 'algorithms') {
              similarity = 0.85;
            } else if (queryText === 'segment') {
              similarity = 0.75;
            }
          }

          return {
            id: c.id,
            videoId: c.videoId,
            chunkIndex: c.chunkIndex,
            text: c.text,
            tokenCount: c.tokenCount,
            startSeconds: c.startSeconds,
            endSeconds: c.endSeconds,
            transcriptSegmentStart: c.transcriptSegmentStart,
            transcriptSegmentEnd: c.transcriptSegmentEnd,
            transcriptSource: c.transcriptSource,
            videoTitle: c.video.title,
            videoUrl: c.video.canonicalUrl,
            creatorName: c.video.creatorName,
            creatorHandle: c.video.creatorHandle,
            videoViews: c.video.views,
            similarity,
          };
        });

        // Filter on similarity threshold (default to 0.7 if not specified to simulate semantic cutoff)
        let minSimilarity = 0.7;
        if (sql.includes('1 - (rc.embedding <=> $1::vector) >= $')) {
          const match = sql.match(/1 - \(rc\.embedding <=> \$1::vector\) >= \$(\d+)/);
          if (match) {
            const idx = parseInt(match[1]!) - 1;
            minSimilarity = params[idx] as number;
          }
        }
        rows = rows.filter((r) => r.similarity >= minSimilarity);

        // Sort by similarity descending
        rows.sort((a, b) => b.similarity - a.similarity);

        // Extract limit/offset (last 2 parameters)
        const offsetIdx = params.length - 1;
        const limitIdx = params.length - 2;
        const limit = params[limitIdx] as number;
        const offset = params[offsetIdx] as number;

        return rows.slice(offset, offset + limit);
      },
    );
  });

  describe('retrieve', () => {
    it('should validate query and retrieve global chunks matching textQuery', async () => {
      const service = new RetrievalService(mockLogger);
      const query = {
        textQuery: 'algorithms',
        scope: {
          type: 'global',
        },
      };

      const context = await service.retrieve(query);

      expect(context.rawQuery).toBe('algorithms');
      // chunk-1 and chunk-3 match "algorithms"
      expect(context.retrievedChunks).toHaveLength(2);
      expect(context.retrievedChunks[0].chunkId).toBe('chunk-1');
      expect(context.retrievedChunks[1].chunkId).toBe('chunk-3');

      // Check citations
      expect(context.retrievedChunks[0].citation.videoTitle).toBe('Video One Title');
      expect(context.retrievedChunks[1].citation.videoTitle).toBe('Video Two Title');

      // Check structured logging was called
      expect(mockLogger.info).toHaveBeenCalledWith('Starting retrieval query execution');
    });

    it('should scope retrieval to a single video', async () => {
      const service = new RetrievalService(mockLogger);
      const query = {
        textQuery: 'algorithms',
        scope: {
          type: 'video',
          videoId: 'video-1',
        },
      };

      const context = await service.retrieve(query);

      // Only chunk-1 should be returned because search is scoped to video-1
      expect(context.retrievedChunks).toHaveLength(1);
      expect(context.retrievedChunks[0].chunkId).toBe('chunk-1');
      expect(context.retrievedChunks[0].videoId).toBe('video-1');
    });

    it('should apply metadata filters correctly', async () => {
      const service = new RetrievalService();
      const query = {
        textQuery: 'segment',
        scope: {
          type: 'global',
        },
        filters: {
          providers: ['youtube'],
          transcriptSources: ['EXTRACTED'],
        },
      };

      const context = await service.retrieve(query);

      // Only chunk-3 has EXTRACTED transcript source
      expect(context.retrievedChunks).toHaveLength(1);
      expect(context.retrievedChunks[0].chunkId).toBe('chunk-3');
      expect(context.retrievedChunks[0].citation.transcriptSource).toBe('EXTRACTED');
    });

    it('should perform balanced comparative retrieval between multiple videos (round-robin)', async () => {
      const service = new RetrievalService(mockLogger);
      const query = {
        textQuery: 'segment',
        scope: {
          type: 'comparative',
          videoIds: ['video-1', 'video-2'],
        },
        limit: 2,
      };

      const context = await service.retrieve(query);

      // $queryRawUnsafe should be called twice (once per videoId in comparative)
      expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(2);

      // 1 chunk from video-1 and 1 chunk from video-2 should be retrieved
      expect(context.retrievedChunks).toHaveLength(2);
      expect(context.metadata.comparativeBalanced).toBe(true);

      const video1Result = context.retrievedChunks.find((c) => c.videoId === 'video-1');
      const video2Result = context.retrievedChunks.find((c) => c.videoId === 'video-2');

      expect(video1Result).toBeDefined();
      expect(video2Result).toBeDefined();

      // Verify diagnostics distribution is present
      expect(context.diagnostics).toBeDefined();
      expect(context.diagnostics?.comparativeDiagnostics?.distribution).toEqual({
        'video-1': 1,
        'video-2': 1,
      });
    });

    it('should respect confidenceThreshold filter on similarity scores', async () => {
      const service = new RetrievalService();
      const query = {
        textQuery: 'dynamic programming',
        scope: {
          type: 'global',
        },
        filters: {
          confidenceThreshold: 0.9, // high threshold
        },
      };

      const context = await service.retrieve(query);

      // chunk-2 contains dynamic programming, has similarity 0.95 >= 0.9
      expect(context.retrievedChunks).toHaveLength(1);
      expect(context.retrievedChunks[0].chunkId).toBe('chunk-2');
    });

    it('should format LLM-ready markdown formattedContextString correctly', async () => {
      const service = new RetrievalService();
      const query = {
        textQuery: 'dynamic programming',
        scope: {
          type: 'video',
          videoId: 'video-1',
        },
      };

      const context = await service.retrieve(query);

      expect(context.formattedContextString).toContain('Video Source: "Video One Title"');
      expect(context.formattedContextString).toContain('URL: https://youtube.com/watch?v=111');
      expect(context.formattedContextString).toContain('Time Segment: 0:10 - 0:25');
      expect(context.formattedContextString).toContain('Relevance Confidence Score:');
      expect(context.formattedContextString).toContain('focusing on dynamic programming.');
    });

    it('should return context message when no results are found', async () => {
      const service = new RetrievalService();
      const query = {
        textQuery: 'completely-non-existent-word',
        scope: {
          type: 'global',
        },
      };

      const context = await service.retrieve(query);
      expect(context.retrievedChunks).toHaveLength(0);
      expect(context.formattedContextString).toBe('No relevant video context found.');
    });

    it('should throw validation error when invalid scope is passed', async () => {
      const service = new RetrievalService();
      const query = {
        textQuery: 'segment',
        scope: {
          type: 'invalid-scope-type',
        },
      };

      await expect(service.retrieve(query)).rejects.toThrow();
    });

    it('should calculate explainable weighted ranking correctly', async () => {
      const service = new RetrievalService();
      const query = {
        textQuery: 'dynamic programming',
        scope: {
          type: 'video',
          videoId: 'video-1',
        },
      };

      const context = await service.retrieve(query);

      // Chunk 2 similarity = 0.95 (semantic score)
      // Transcript source = NATIVE => score 1.0
      // Video 1 views = 10000 => log10(10000)/7 = 4/7 = 0.5714
      // Final weighted score = (0.95 * 0.7) + (1.0 * 0.2) + (0.5714 * 0.1) = 0.665 + 0.2 + 0.05714 = 0.9221
      expect(context.retrievedChunks).toHaveLength(1);
      const score = context.retrievedChunks[0].score;
      expect(score).toBeCloseTo(0.9221, 3);

      // Verify diagnostics breakdown is present and accurate
      expect(context.diagnostics).toBeDefined();
      const diag = context.diagnostics?.rankingDiagnostics[0];
      expect(diag).toBeDefined();
      expect(diag?.scoreBreakdown.semanticSimilarity).toBeCloseTo(0.95 * 0.7, 3);
      expect(diag?.scoreBreakdown.transcriptConfidence).toBeCloseTo(1.0 * 0.2, 3);
      expect(diag?.scoreBreakdown.engagementWeight).toBeCloseTo(0.05714, 3);
    });
  });
});
