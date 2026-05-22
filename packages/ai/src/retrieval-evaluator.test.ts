import { vi, describe, it, expect, beforeEach } from 'vitest';
import { RetrievalEvaluator } from './retrieval-evaluator.js';
import { ChunkDiagnosticsService } from './chunk-diagnostics.js';
import { RetrievalService } from './retrieval-service.js';
import { prisma } from '@rag/db';
import type { Video } from '@prisma/client';
import { type RetrievalResult, type RetrievalRankingDiagnostics } from '@rag/shared';

vi.mock('@rag/db', () => {
  return {
    prisma: {
      video: {
        findMany: vi.fn(),
      },
    },
  };
});

vi.mock('./chunk-diagnostics.js', () => {
  return {
    ChunkDiagnosticsService: {
      validateCitation: vi.fn(),
    },
  };
});

vi.mock('./retrieval-service.js', () => {
  const mockRetrieve = vi.fn();
  return {
    RetrievalService: vi.fn().mockImplementation(() => {
      return {
        retrieve: mockRetrieve,
      };
    }),
  };
});

describe('RetrievalEvaluator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('evaluateRetrieval', () => {
    it('should correctly calculate metrics for highly precise and diverse results', async () => {
      vi.mocked(ChunkDiagnosticsService.validateCitation).mockResolvedValue({ isValid: true });

      const results: RetrievalResult[] = [
        {
          chunkId: 'chunk-1',
          videoId: 'video-1',
          chunkIndex: 0,
          text: 'This is some text about machine learning algorithms.',
          tokenCount: 10,
          score: 0.85,
          citation: {
            videoId: 'video-1',
            videoTitle: 'ML Title',
            videoUrl: 'http://ml.com',
            startSeconds: 0,
            endSeconds: 10,
            chunkId: 'chunk-1',
            transcriptSegmentStart: 0,
            transcriptSegmentEnd: 1,
            transcriptSource: 'NATIVE',
          },
        },
        {
          chunkId: 'chunk-2',
          videoId: 'video-2',
          chunkIndex: 0,
          text: 'Totally different topic related to user interface design.',
          tokenCount: 9,
          score: 0.78,
          citation: {
            videoId: 'video-2',
            videoTitle: 'UI Title',
            videoUrl: 'http://ui.com',
            startSeconds: 0,
            endSeconds: 12,
            chunkId: 'chunk-2',
            transcriptSegmentStart: 0,
            transcriptSegmentEnd: 1,
            transcriptSource: 'NATIVE',
          },
        },
      ];

      const diagnostics: RetrievalRankingDiagnostics[] = [
        {
          chunkId: 'chunk-1',
          videoId: 'video-1',
          scoreBreakdown: {
            semanticSimilarity: 0.6,
            transcriptConfidence: 0.2,
            engagementWeight: 0.05,
          },
          rawScores: {
            semanticSimilarity: 0.85,
            transcriptConfidence: 1.0,
            engagementWeight: 0.5,
          },
        },
        {
          chunkId: 'chunk-2',
          videoId: 'video-2',
          scoreBreakdown: {
            semanticSimilarity: 0.55,
            transcriptConfidence: 0.2,
            engagementWeight: 0.03,
          },
          rawScores: {
            semanticSimilarity: 0.78,
            transcriptConfidence: 1.0,
            engagementWeight: 0.3,
          },
        },
      ];

      const report = await RetrievalEvaluator.evaluateRetrieval(
        'algorithms and UI design',
        results,
        diagnostics,
        150,
        true,
      );

      expect(report.query).toBe('algorithms and UI design');
      expect(report.metrics.averageRetrievalScore).toBeCloseTo(0.815);
      expect(report.metrics.precision).toBe(1.0); // Both similarity scores (0.85, 0.78) are >= 0.7
      expect(report.metrics.citationIntegrityScore).toBe(1.0); // Both validateCitation returned true
      expect(report.metrics.comparativeBalanceScore).toBeCloseTo(1.0); // Multi-video balanced distribution
      expect(report.metrics.diversityScore).toBeGreaterThan(0.5); // Very diverse texts
      expect(report.degradationIndicators).toHaveLength(0);
    });

    it('should detect low confidence, repetitive chunks, and poor citation traceability degradation', async () => {
      // Mock validation to fail for one citation
      vi.mocked(ChunkDiagnosticsService.validateCitation)
        .mockResolvedValueOnce({ isValid: true })
        .mockResolvedValueOnce({ isValid: false, reason: 'Out of range' });

      const results: RetrievalResult[] = [
        {
          chunkId: 'chunk-1',
          videoId: 'video-1',
          chunkIndex: 0,
          text: 'This is repetitive text about database indexing systems.',
          tokenCount: 10,
          score: 0.62,
          citation: {
            videoId: 'video-1',
            videoTitle: 'DB Title',
            videoUrl: 'http://db.com',
            startSeconds: 0,
            endSeconds: 10,
            chunkId: 'chunk-1',
            transcriptSegmentStart: 0,
            transcriptSegmentEnd: 1,
            transcriptSource: 'NATIVE',
          },
        },
        {
          chunkId: 'chunk-2',
          videoId: 'video-1',
          chunkIndex: 1,
          text: 'This is repetitive text about database indexing systems.',
          tokenCount: 10,
          score: 0.61,
          citation: {
            videoId: 'video-1',
            videoTitle: 'DB Title',
            videoUrl: 'http://db.com',
            startSeconds: 10,
            endSeconds: 20,
            chunkId: 'chunk-2',
            transcriptSegmentStart: 2,
            transcriptSegmentEnd: 3,
            transcriptSource: 'NATIVE',
          },
        },
      ];

      const diagnostics: RetrievalRankingDiagnostics[] = [
        {
          chunkId: 'chunk-1',
          videoId: 'video-1',
          scoreBreakdown: {
            semanticSimilarity: 0.42,
            transcriptConfidence: 0.2,
            engagementWeight: 0.0,
          },
          rawScores: {
            semanticSimilarity: 0.62,
            transcriptConfidence: 1.0,
            engagementWeight: 0.0,
          },
        },
        {
          chunkId: 'chunk-2',
          videoId: 'video-1',
          scoreBreakdown: {
            semanticSimilarity: 0.41,
            transcriptConfidence: 0.2,
            engagementWeight: 0.0,
          },
          rawScores: {
            semanticSimilarity: 0.61,
            transcriptConfidence: 1.0,
            engagementWeight: 0.0,
          },
        },
      ];

      const report = await RetrievalEvaluator.evaluateRetrieval(
        'database index',
        results,
        diagnostics,
        1200, // Latency > 1000
        false,
      );

      expect(report.metrics.precision).toBe(0.0); // Both < 0.7
      expect(report.metrics.citationIntegrityScore).toBe(0.5); // 1 valid, 1 invalid
      expect(report.failureAnalysis.lowConfidenceCount).toBe(2);
      expect(report.failureAnalysis.repetitiveChunkCount).toBeGreaterThan(0);
      expect(report.failureAnalysis.poorCitationTraceabilityCount).toBe(1);

      expect(report.degradationIndicators).toContain(
        'Average retrieval relevance is below threshold of 0.7',
      );
      expect(report.degradationIndicators).toContain(
        'Low precision: only 0% of retrieved chunks are highly relevant',
      );
      expect(report.degradationIndicators).toContain(
        'Repetitive or redundant chunks detected in result set',
      );
      expect(report.degradationIndicators).toContain(
        'Citation traceability issue: failed segment validation for some retrieved chunks',
      );
      expect(report.degradationIndicators).toContain(
        'High retrieval latency: execution took 1200ms',
      );
    });
  });

  describe('getDeterministicScenarios', () => {
    it('should return 5 pre-configured deterministic scenarios', () => {
      const scenarios = RetrievalEvaluator.getDeterministicScenarios();
      expect(scenarios).toHaveLength(5);
      expect(scenarios.map((s) => s.category)).toEqual([
        'hook_analysis',
        'emotional_engagement',
        'creator_comparison',
        'cta_analysis',
        'pacing_style',
      ]);
    });
  });

  describe('runEvaluationScenarios', () => {
    it('should run scenarios against mocked retrieval service and compile bulk report', async () => {
      // Mock db video lookup to return 2 videos
      vi.mocked(prisma.video.findMany).mockResolvedValue([
        { id: 'video-1' } as Video,
        { id: 'video-2' } as Video,
      ]);

      vi.mocked(ChunkDiagnosticsService.validateCitation).mockResolvedValue({ isValid: true });

      // Mock RetrievalService's retrieve implementation
      const dummyResults: RetrievalResult[] = [
        {
          chunkId: 'chunk-1',
          videoId: 'video-1',
          chunkIndex: 0,
          text: 'Video 1 content detail.',
          tokenCount: 4,
          score: 0.8,
          citation: {
            videoId: 'video-1',
            videoTitle: 'V1',
            videoUrl: 'http://v1.com',
            startSeconds: 0,
            endSeconds: 5,
            chunkId: 'chunk-1',
            transcriptSegmentStart: 0,
            transcriptSegmentEnd: 1,
            transcriptSource: 'NATIVE',
          },
        },
      ];

      const dummyDiagnostics: RetrievalRankingDiagnostics[] = [
        {
          chunkId: 'chunk-1',
          videoId: 'video-1',
          scoreBreakdown: {
            semanticSimilarity: 0.56,
            transcriptConfidence: 0.2,
            engagementWeight: 0.04,
          },
          rawScores: {
            semanticSimilarity: 0.8,
            transcriptConfidence: 1.0,
            engagementWeight: 0.4,
          },
        },
      ];

      const retrieveSpy = vi.fn().mockResolvedValue({
        retrievedChunks: dummyResults,
        rawQuery: 'test query',
        groupedContext: {},
        formattedContextString: 'formatted context',
        metadata: {
          totalChunks: 1,
          executionTimeMs: 15,
          comparativeBalanced: false,
        },
        diagnostics: {
          executionTimeMs: 15,
          queryVectorGenerated: true,
          rankingDiagnostics: dummyDiagnostics,
        },
      });

      // Override the RetrievalService constructor mock instance retrieve implementation
      vi.mocked(RetrievalService).mockImplementation(() => {
        return { retrieve: retrieveSpy } as Pick<
          InstanceType<typeof RetrievalService>,
          'retrieve'
        > as InstanceType<typeof RetrievalService>;
      });

      const bulkReport = await RetrievalEvaluator.runEvaluationScenarios();

      expect(bulkReport.totalScenarios).toBe(5);
      expect(bulkReport.results).toHaveLength(5);
      expect(bulkReport.passedScenarios).toBe(5); // All scores are 0.8 >= expectedMinScore
      expect(bulkReport.failedScenarios).toBe(0);
      expect(bulkReport.averageLatencyMs).toBeGreaterThanOrEqual(0);
    });
  });
});
