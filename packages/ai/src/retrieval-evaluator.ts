import { prisma } from '@rag/db';
import {
  type RetrievalResult,
  type RetrievalRankingDiagnostics,
  type RetrievalEvaluationReport,
  type EvaluationScenario,
  type BulkEvaluationReport,
  type ScenarioEvaluationResult,
} from '@rag/shared';
import { ChunkDiagnosticsService } from './chunk-diagnostics.js';
import { RetrievalService, type RetrievalLogger } from './retrieval-service.js';

function calculateJaccardSimilarity(textA: string, textB: string): number {
  const setA = new Set(textA.toLowerCase().split(/\s+/).filter(Boolean));
  const setB = new Set(textB.toLowerCase().split(/\s+/).filter(Boolean));
  if (setA.size === 0 && setB.size === 0) return 1.0;

  let intersectionSize = 0;
  for (const item of setA) {
    if (setB.has(item)) {
      intersectionSize++;
    }
  }
  const unionSize = setA.size + setB.size - intersectionSize;
  return intersectionSize / unionSize;
}

export class RetrievalEvaluator {
  /**
   * Evaluates the metrics of a query execution.
   */
  static async evaluateRetrieval(
    textQuery: string,
    results: RetrievalResult[],
    diagnostics: RetrievalRankingDiagnostics[],
    retrievalLatencyMs: number,
    comparativeBalanced: boolean,
    logger?: RetrievalLogger,
  ): Promise<RetrievalEvaluationReport> {
    const log = logger || {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    };

    log.info('Evaluating retrieval quality', { textQuery, resultCount: results.length });

    // 1. Calculate Average Retrieval Score
    const averageRetrievalScore =
      results.length > 0 ? results.reduce((sum, r) => sum + r.score, 0) / results.length : 0.0;

    // 2. Query Relevance (based on raw semantic similarity if available)
    const semanticRawScores = diagnostics.map((d) => d.rawScores.semanticSimilarity);
    const averageSimilarity =
      semanticRawScores.length > 0
        ? semanticRawScores.reduce((sum, s) => sum + s, 0) / semanticRawScores.length
        : averageRetrievalScore;

    // 3. Precision (ratio of chunks exceeding threshold 0.7)
    const precisionThreshold = 0.7;
    const preciseCount =
      semanticRawScores.length > 0
        ? semanticRawScores.filter((s) => s >= precisionThreshold).length
        : results.filter((r) => r.score >= precisionThreshold).length;
    const precision = results.length > 0 ? preciseCount / results.length : 1.0;

    // 4. Chunk Distribution (video ID mapping)
    const chunkDistribution: Record<string, number> = {};
    for (const r of results) {
      chunkDistribution[r.videoId] = (chunkDistribution[r.videoId] || 0) + 1;
    }

    // 5. Comparative Balance Score
    const counts = Object.values(chunkDistribution);
    let comparativeBalanceScore = 1.0;
    if (counts.length > 1) {
      const avgCount = results.length / counts.length;
      const variance =
        counts.reduce((sum, c) => sum + Math.pow(c - avgCount, 2), 0) / counts.length;
      const stdDev = Math.sqrt(variance);
      comparativeBalanceScore = Math.max(0, 1.0 - stdDev / Math.max(1, avgCount));
    } else if (counts.length === 1) {
      comparativeBalanceScore = comparativeBalanced ? 0.0 : 1.0;
    }

    // 6. Chunk Diversity (text-based Jaccard distance + source ratio)
    let pairSimilaritySum = 0;
    let pairsCount = 0;
    for (let i = 0; i < results.length; i++) {
      for (let j = i + 1; j < results.length; j++) {
        const textA = results[i]?.text || '';
        const textB = results[j]?.text || '';
        pairSimilaritySum += calculateJaccardSimilarity(textA, textB);
        pairsCount++;
      }
    }
    const avgPairSimilarity = pairsCount > 0 ? pairSimilaritySum / pairsCount : 0.0;
    const textDiversity = 1.0 - avgPairSimilarity;
    const uniqueVideos = new Set(results.map((r) => r.videoId));
    const sourceRatio = results.length > 0 ? uniqueVideos.size / results.length : 1.0;
    const diversityScore = results.length > 0 ? textDiversity * 0.6 + sourceRatio * 0.4 : 1.0;

    // 7. Citation Integrity (ratio of valid citations traced back to database)
    let validCitations = 0;
    let poorCitationTraceabilityCount = 0;
    for (const res of results) {
      const valResult = await ChunkDiagnosticsService.validateCitation(res.citation);
      if (valResult.isValid) {
        validCitations++;
      } else {
        poorCitationTraceabilityCount++;
      }
    }
    const citationIntegrityScore = results.length > 0 ? validCitations / results.length : 1.0;

    // 8. Ranking Factor Contributions
    let semanticSimilarityAvg = 0;
    let transcriptConfidenceAvg = 0;
    let engagementWeightAvg = 0;
    if (diagnostics.length > 0) {
      semanticSimilarityAvg =
        diagnostics.reduce((sum, d) => sum + d.scoreBreakdown.semanticSimilarity, 0) /
        diagnostics.length;
      transcriptConfidenceAvg =
        diagnostics.reduce((sum, d) => sum + d.scoreBreakdown.transcriptConfidence, 0) /
        diagnostics.length;
      engagementWeightAvg =
        diagnostics.reduce((sum, d) => sum + d.scoreBreakdown.engagementWeight, 0) /
        diagnostics.length;
    }

    // 9. Failure Analysis
    const lowConfidenceThreshold = 0.65;
    const lowConfidenceCount =
      semanticRawScores.length > 0
        ? semanticRawScores.filter((s) => s < lowConfidenceThreshold).length
        : results.filter((r) => r.score < lowConfidenceThreshold).length;

    // Repetitive Chunk Check (Jaccard similarity > 0.6 or consecutive chunks)
    let repetitiveChunkCount = 0;
    const checkedPairs = new Set<string>();
    for (let i = 0; i < results.length; i++) {
      for (let j = i + 1; j < results.length; j++) {
        const c1 = results[i]!;
        const c2 = results[j]!;
        const pairKey = [c1.chunkId, c2.chunkId].sort().join(',');
        if (checkedPairs.has(pairKey)) continue;
        checkedPairs.add(pairKey);

        const jaccard = calculateJaccardSimilarity(c1.text, c2.text);
        const isConsecutive =
          c1.videoId === c2.videoId && Math.abs(c1.chunkIndex - c2.chunkIndex) === 1;
        if (jaccard > 0.6 || (isConsecutive && jaccard > 0.45)) {
          repetitiveChunkCount++;
        }
      }
    }

    // Over-dominant video check (>60% representation in global search with multiple sources)
    let overDominantVideoCount = 0;
    if (uniqueVideos.size > 1) {
      for (const [vid, count] of Object.entries(chunkDistribution)) {
        if (count / results.length > 0.6) {
          overDominantVideoCount++;
          log.warn(`Dominant video detected in retrieval result`, {
            videoId: vid,
            percentage: count / results.length,
          });
        }
      }
    }

    const lowDiversityDetected = diversityScore < 0.5;

    // 10. Compile Degradation Indicators & Structured Logs
    const degradationIndicators: string[] = [];
    if (averageSimilarity < 0.7) {
      degradationIndicators.push('Average retrieval relevance is below threshold of 0.7');
    }
    if (precision < 0.6) {
      degradationIndicators.push(
        `Low precision: only ${(precision * 100).toFixed(0)}% of retrieved chunks are highly relevant`,
      );
    }
    if (lowDiversityDetected) {
      degradationIndicators.push(
        `Low diversity in retrieved context (diversity score: ${diversityScore.toFixed(2)})`,
      );
    }
    if (repetitiveChunkCount > 0) {
      degradationIndicators.push('Repetitive or redundant chunks detected in result set');
    }
    if (overDominantVideoCount > 0) {
      degradationIndicators.push('Single video dominates global search results');
    }
    if (poorCitationTraceabilityCount > 0) {
      degradationIndicators.push(
        'Citation traceability issue: failed segment validation for some retrieved chunks',
      );
    }
    if (retrievalLatencyMs > 1000) {
      degradationIndicators.push(`High retrieval latency: execution took ${retrievalLatencyMs}ms`);
    }

    // Log structured evaluation metrics
    log.info('Retrieval evaluation metrics compiled', {
      query: textQuery,
      latencyMs: retrievalLatencyMs,
      averageRetrievalScore,
      precision,
      diversityScore,
      citationIntegrityScore,
      comparativeBalanceScore,
      degradationCount: degradationIndicators.length,
      indicators: degradationIndicators,
    });

    return {
      query: textQuery,
      metrics: {
        averageRetrievalScore,
        retrievalLatencyMs,
        precision,
        diversityScore,
        citationIntegrityScore,
        comparativeBalanceScore,
      },
      failureAnalysis: {
        lowConfidenceCount,
        repetitiveChunkCount,
        overDominantVideoCount,
        poorCitationTraceabilityCount,
        lowDiversityDetected,
      },
      chunkDistribution,
      rankingFactorContributions: {
        semanticSimilarityAvg,
        transcriptConfidenceAvg,
        engagementWeightAvg,
      },
      degradationIndicators,
    };
  }

  /**
   * Returns pre-configured evaluation cases.
   */
  static getDeterministicScenarios(): EvaluationScenario[] {
    return [
      {
        id: 'scenario-hook',
        name: 'Hook Analysis Query',
        category: 'hook_analysis',
        textQuery: 'How does the creator grab attention in the first 30 seconds?',
        expectedMinScore: 0.65,
      },
      {
        id: 'scenario-engagement',
        name: 'Emotional Engagement Query',
        category: 'emotional_engagement',
        textQuery: 'Where is the emotional peak or peak excitement in the video?',
        expectedMinScore: 0.65,
      },
      {
        id: 'scenario-creator',
        name: 'Creator Comparison Query',
        category: 'creator_comparison',
        textQuery: 'Compare the communication styles and pacing of the presenters.',
        expectedMinScore: 0.6,
      },
      {
        id: 'scenario-cta',
        name: 'CTA Analysis Query',
        category: 'cta_analysis',
        textQuery: 'When is the call to action subscribe prompt or sponsor CTA given?',
        expectedMinScore: 0.65,
      },
      {
        id: 'scenario-pacing',
        name: 'Pacing and Style Query',
        category: 'pacing_style',
        textQuery: 'What editing pace, visual style, or talking speed is present?',
        expectedMinScore: 0.65,
      },
    ];
  }

  /**
   * Runs all pre-configured scenarios and compiles a bulk summary report.
   */
  static async runEvaluationScenarios(logger?: RetrievalLogger): Promise<BulkEvaluationReport> {
    const scenarios = RetrievalEvaluator.getDeterministicScenarios();
    const results: ScenarioEvaluationResult[] = [];

    const dbVideos = await prisma.video.findMany({ select: { id: true }, take: 5 });
    const allVideoIds = dbVideos.map((v) => v.id);

    const retrievalService = new RetrievalService(logger);

    let totalLatency = 0;
    let passedCount = 0;
    let failedCount = 0;

    for (const scenario of scenarios) {
      try {
        const qStartTime = Date.now();
        let queryResults;
        let isComparative = false;

        // Dynamically adjust scope parameters based on database state
        if (scenario.category === 'creator_comparison' && allVideoIds.length >= 2) {
          isComparative = true;
          queryResults = await retrievalService.retrieve({
            textQuery: scenario.textQuery,
            scope: { type: 'comparative', videoIds: allVideoIds.slice(0, 2) },
            limit: 6,
          });
        } else if (allVideoIds.length > 0) {
          queryResults = await retrievalService.retrieve({
            textQuery: scenario.textQuery,
            scope: { type: 'video', videoId: allVideoIds[0] },
            limit: 6,
          });
        } else {
          // Global fallback
          queryResults = await retrievalService.retrieve({
            textQuery: scenario.textQuery,
            scope: { type: 'global' },
            limit: 6,
          });
        }

        const latency = Date.now() - qStartTime;
        totalLatency += latency;

        const evalReport = await RetrievalEvaluator.evaluateRetrieval(
          scenario.textQuery,
          queryResults.retrievedChunks,
          queryResults.diagnostics?.rankingDiagnostics || [],
          latency,
          isComparative,
          logger,
        );

        const minExpected = scenario.expectedMinScore || 0.65;
        const scorePass = evalReport.metrics.averageRetrievalScore >= minExpected;
        const citationPass = evalReport.metrics.citationIntegrityScore === 1.0;
        const passed = scorePass && citationPass;

        if (passed) {
          passedCount++;
        } else {
          failedCount++;
        }

        results.push({
          scenario,
          report: evalReport,
          passed,
        });
      } catch (err) {
        failedCount++;
        results.push({
          scenario,
          passed: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const avgLatency = scenarios.length > 0 ? totalLatency / scenarios.length : 0;
    const globalDegradationIndicators: string[] = [];

    // Aggregate degradation indicators across scenarios
    const allIndicators = results.flatMap((r) => r.report?.degradationIndicators || []);
    const indicatorCounts: Record<string, number> = {};
    for (const ind of allIndicators) {
      indicatorCounts[ind] = (indicatorCounts[ind] || 0) + 1;
    }
    for (const [ind, count] of Object.entries(indicatorCounts)) {
      if (count >= 2) {
        globalDegradationIndicators.push(`${ind} (affects ${count} scenarios)`);
      }
    }

    return {
      timestamp: new Date().toISOString(),
      totalScenarios: scenarios.length,
      passedScenarios: passedCount,
      failedScenarios: failedCount,
      averageLatencyMs: avgLatency,
      results,
      globalDegradationIndicators,
    };
  }
}
