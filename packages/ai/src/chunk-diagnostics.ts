import { prisma } from '@rag/db';
import {
  type ChunkQualityReport,
  type ChunkDiagnosticDetail,
  type RetrievalCitation,
} from '@rag/shared';
import { ChunkingService, type SegmentInput } from './chunking-service.js';

export class ChunkDiagnosticsService {
  /**
   * Evaluates quality metrics, continuity, coherence, and provenance for in-memory pending chunks.
   */
  static analyzePendingChunks(
    videoId: string,
    videoTitle: string,
    segments: SegmentInput[],
    chunks: {
      chunkIndex: number;
      text: string;
      tokenCount: number;
      startSeconds: number;
      endSeconds: number;
      transcriptSegmentStart: number;
      transcriptSegmentEnd: number;
    }[],
    minChunkSize: number = 100,
    timeGapThresholdSeconds: number = 3.0,
  ): ChunkQualityReport {
    const totalSegments = segments.length;
    const totalChunks = chunks.length;

    // Sort inputs chronologically
    const sortedSegments = [...segments].sort((a, b) => a.sequenceIndex - b.sequenceIndex);
    const sortedChunks = [...chunks].sort((a, b) => a.chunkIndex - b.chunkIndex);

    const segmentMap = new Map<number, SegmentInput>();
    for (const seg of sortedSegments) {
      segmentMap.set(seg.sequenceIndex, seg);
    }

    // Diagnostics per chunk
    const chunkDiagnostics: ChunkDiagnosticDetail[] = [];
    let sumTokens = 0;
    let sumWords = 0;
    let sumOverlapTokens = 0;
    let overlapCount = 0;

    const lowQualityChunkIndices: number[] = [];

    for (let i = 0; i < sortedChunks.length; i++) {
      const chunk = sortedChunks[i];
      if (!chunk) continue;

      const words = chunk.text.trim().split(/\s+/).filter(Boolean);
      const wordCount = words.length;
      sumTokens += chunk.tokenCount;
      sumWords += wordCount;

      // Check semantic coherence
      const endsWithPunctuation = /[.!?]$/.test(chunk.text.trim());

      // Determine if it splits a sentence and check time gaps
      let hasTimeGapBoundary = false;
      const lastSeg = segmentMap.get(chunk.transcriptSegmentEnd);
      const nextSeg = segmentMap.get(chunk.transcriptSegmentEnd + 1);

      if (lastSeg && nextSeg) {
        const gap = nextSeg.startSeconds - lastSeg.endSeconds;
        hasTimeGapBoundary = gap > timeGapThresholdSeconds;
      }

      const splitsSentence = !endsWithPunctuation && !hasTimeGapBoundary;

      // Scoring heuristic (0 to 100)
      let semanticCoherenceScore = 100;
      if (splitsSentence) {
        semanticCoherenceScore -= 30;
      }
      if (chunk.tokenCount < minChunkSize) {
        semanticCoherenceScore -= 20;
      }
      if (chunk.tokenCount < minChunkSize / 2) {
        semanticCoherenceScore -= 20;
      }
      if (wordCount === 0) {
        semanticCoherenceScore = 0;
      }
      semanticCoherenceScore = Math.max(0, Math.min(100, semanticCoherenceScore));

      // Overlap with previous chunk
      let overlapWithPrevious = null;
      let continuityWithPrevious = null;

      if (i > 0) {
        const prev = sortedChunks[i - 1];
        if (prev) {
          const overlapStart = Math.max(prev.transcriptSegmentStart, chunk.transcriptSegmentStart);
          const overlapEnd = Math.min(prev.transcriptSegmentEnd, chunk.transcriptSegmentEnd);

          if (overlapStart <= overlapEnd) {
            const overlapSegments: SegmentInput[] = [];
            for (let idx = overlapStart; idx <= overlapEnd; idx++) {
              const seg = segmentMap.get(idx);
              if (seg) overlapSegments.push(seg);
            }

            const overlapText = overlapSegments.map((s) => s.text).join(' ');
            const overlapTokens = ChunkingService.estimateTokenCount(overlapText);
            const overlapWords = overlapText.trim().split(/\s+/).filter(Boolean).length;

            overlapWithPrevious = {
              tokens: overlapTokens,
              words: overlapWords,
              segments: overlapSegments.length,
            };

            sumOverlapTokens += overlapTokens;
            overlapCount++;
          }

          const gapSeconds = chunk.startSeconds - prev.endSeconds;
          continuityWithPrevious = {
            gapSeconds,
            hasOverlap: overlapStart <= overlapEnd,
          };
        }
      }

      chunkDiagnostics.push({
        chunkIndex: chunk.chunkIndex,
        textPreview: chunk.text.length > 60 ? `${chunk.text.substring(0, 60)}...` : chunk.text,
        tokenCount: chunk.tokenCount,
        wordCount,
        startSeconds: chunk.startSeconds,
        endSeconds: chunk.endSeconds,
        segmentStart: chunk.transcriptSegmentStart,
        segmentEnd: chunk.transcriptSegmentEnd,
        semanticCoherenceScore,
        coherenceDetails: {
          endsWithPunctuation,
          hasTimeGapBoundary,
          splitsSentence,
        },
        overlapWithPrevious,
        continuityWithPrevious,
      });

      // Mark empty or low quality chunks
      if (chunk.tokenCount < minChunkSize || wordCount === 0) {
        lowQualityChunkIndices.push(chunk.chunkIndex);
      }
    }

    // Find orphaned segments
    const coveredSegmentIndices = new Set<number>();
    for (const chunk of sortedChunks) {
      for (let idx = chunk.transcriptSegmentStart; idx <= chunk.transcriptSegmentEnd; idx++) {
        coveredSegmentIndices.add(idx);
      }
    }

    const orphanedSegmentIndices: number[] = [];
    for (const seg of sortedSegments) {
      if (!coveredSegmentIndices.has(seg.sequenceIndex)) {
        orphanedSegmentIndices.push(seg.sequenceIndex);
      }
    }

    // Build validation issues
    const issues: string[] = [];
    let citationTraceabilityValid = true;
    let timestampPreservationValid = true;
    let chunkContinuityValid = true;

    if (sortedChunks.length > 0) {
      const minSegIdx = sortedSegments[0]?.sequenceIndex ?? 0;
      const maxSegIdx = sortedSegments[sortedSegments.length - 1]?.sequenceIndex ?? 0;

      for (const chunk of sortedChunks) {
        // Traceability
        if (chunk.transcriptSegmentStart < minSegIdx || chunk.transcriptSegmentEnd > maxSegIdx) {
          citationTraceabilityValid = false;
          issues.push(
            `Chunk ${chunk.chunkIndex} segments [${chunk.transcriptSegmentStart}, ${chunk.transcriptSegmentEnd}] out of video segment range [${minSegIdx}, ${maxSegIdx}].`,
          );
        }

        // Timestamp boundaries
        if (chunk.startSeconds > chunk.endSeconds) {
          timestampPreservationValid = false;
          issues.push(
            `Chunk ${chunk.chunkIndex} has invalid timestamp order: startSeconds (${chunk.startSeconds}) > endSeconds (${chunk.endSeconds}).`,
          );
        }

        const startSeg = segmentMap.get(chunk.transcriptSegmentStart);
        const endSeg = segmentMap.get(chunk.transcriptSegmentEnd);
        if (startSeg && Math.abs(chunk.startSeconds - startSeg.startSeconds) > 0.01) {
          timestampPreservationValid = false;
          issues.push(
            `Chunk ${chunk.chunkIndex} startSeconds (${chunk.startSeconds}) does not align with segment ${chunk.transcriptSegmentStart} start (${startSeg.startSeconds}).`,
          );
        }
        if (endSeg && Math.abs(chunk.endSeconds - endSeg.endSeconds) > 0.01) {
          timestampPreservationValid = false;
          issues.push(
            `Chunk ${chunk.chunkIndex} endSeconds (${chunk.endSeconds}) does not align with segment ${chunk.transcriptSegmentEnd} end (${endSeg.endSeconds}).`,
          );
        }
      }

      // Continuity checks
      for (let i = 1; i < sortedChunks.length; i++) {
        const prev = sortedChunks[i - 1];
        const curr = sortedChunks[i];
        if (prev && curr) {
          if (curr.chunkIndex !== prev.chunkIndex + 1) {
            chunkContinuityValid = false;
            issues.push(
              `Chunk index gap detected: indices ${prev.chunkIndex} and ${curr.chunkIndex} are not sequential.`,
            );
          }
          if (curr.startSeconds < prev.startSeconds) {
            chunkContinuityValid = false;
            issues.push(
              `Out of order chunks: Chunk ${curr.chunkIndex} starts at ${curr.startSeconds} before Chunk ${prev.chunkIndex} starts at ${prev.startSeconds}.`,
            );
          }
        }
      }
    }

    if (orphanedSegmentIndices.length > 0) {
      issues.push(
        `Orphaned segments detected: segments ${orphanedSegmentIndices.join(', ')} are not covered by any chunk.`,
      );
    }

    return {
      videoId,
      videoTitle,
      totalSegments,
      totalChunks,
      metrics: {
        averageChunkTokens: totalChunks > 0 ? Math.round((sumTokens / totalChunks) * 100) / 100 : 0,
        averageChunkWords: totalChunks > 0 ? Math.round((sumWords / totalChunks) * 100) / 100 : 0,
        averageOverlapTokens:
          overlapCount > 0 ? Math.round((sumOverlapTokens / overlapCount) * 100) / 100 : 0,
        orphanedSegmentCount: orphanedSegmentIndices.length,
        orphanedSegmentIndices,
        emptyOrLowQualityCount: lowQualityChunkIndices.length,
        lowQualityChunkIndices,
      },
      chunkDiagnostics,
      validationReport: {
        citationTraceabilityValid,
        timestampPreservationValid,
        chunkContinuityValid: chunkContinuityValid && orphanedSegmentIndices.length === 0,
        issues,
      },
    };
  }

  /**
   * Retrieves database retrieval chunk details and performs complete diagnostics checks.
   */
  static async analyzeVideoChunks(videoId: string): Promise<ChunkQualityReport> {
    const video = await prisma.video.findUnique({
      where: { id: videoId },
      include: {
        transcriptSegments: {
          orderBy: { sequenceIndex: 'asc' },
        },
        retrievalChunks: {
          orderBy: { chunkIndex: 'asc' },
        },
      },
    });

    if (!video) {
      throw new Error(`Video not found: ${videoId}`);
    }

    const segments: SegmentInput[] = video.transcriptSegments.map((s) => ({
      sequenceIndex: s.sequenceIndex,
      startSeconds: s.startSeconds,
      endSeconds: s.endSeconds,
      text: s.text,
    }));

    const chunks = video.retrievalChunks.map((c) => ({
      chunkIndex: c.chunkIndex,
      text: c.text,
      tokenCount: c.tokenCount,
      startSeconds: c.startSeconds,
      endSeconds: c.endSeconds,
      transcriptSegmentStart: c.transcriptSegmentStart,
      transcriptSegmentEnd: c.transcriptSegmentEnd,
    }));

    return ChunkDiagnosticsService.analyzePendingChunks(
      video.id,
      video.title,
      segments,
      chunks,
      100,
      3.0,
    );
  }

  /**
   * Validates a retrieval citation for traceability back to original video transcript segments
   * and preserves correct timestamp alignments.
   */
  static async validateCitation(
    citation: RetrievalCitation,
  ): Promise<{ isValid: boolean; reason?: string }> {
    const video = await prisma.video.findUnique({
      where: { id: citation.videoId },
      include: {
        transcriptSegments: {
          where: {
            sequenceIndex: {
              gte: citation.transcriptSegmentStart,
              lte: citation.transcriptSegmentEnd,
            },
          },
          orderBy: { sequenceIndex: 'asc' },
        },
      },
    });

    if (!video) {
      return { isValid: false, reason: `Video ID ${citation.videoId} not found in database.` };
    }

    if (video.transcriptSegments.length === 0) {
      return {
        isValid: false,
        reason: `No transcript segments found in the range [${citation.transcriptSegmentStart}, ${citation.transcriptSegmentEnd}] for video ${citation.videoId}.`,
      };
    }

    const firstSeg = video.transcriptSegments[0];
    const lastSeg = video.transcriptSegments[video.transcriptSegments.length - 1];

    if (!firstSeg || !lastSeg) {
      return { isValid: false, reason: 'Invalid transcript segments retrieved.' };
    }

    const expectedStart = firstSeg.startSeconds;
    const expectedEnd = lastSeg.endSeconds;

    const EPSILON = 0.01;
    if (Math.abs(citation.startSeconds - expectedStart) > EPSILON) {
      return {
        isValid: false,
        reason: `Citation startSeconds (${citation.startSeconds}) does not match expected segment startSeconds (${expectedStart}).`,
      };
    }

    if (Math.abs(citation.endSeconds - expectedEnd) > EPSILON) {
      return {
        isValid: false,
        reason: `Citation endSeconds (${citation.endSeconds}) does not match expected segment endSeconds (${expectedEnd}).`,
      };
    }

    if (citation.startSeconds > citation.endSeconds) {
      return {
        isValid: false,
        reason: `Citation startSeconds (${citation.startSeconds}) is greater than endSeconds (${citation.endSeconds}).`,
      };
    }

    return { isValid: true };
  }

  /**
   * Verifies comparative query outputs are balanced across active video IDs.
   */
  static validateComparativeBalancing(
    videoIds: string[],
    retrievedChunks: { videoId: string }[],
  ): { isBalanced: boolean; distribution: Record<string, number>; reason?: string } {
    const distribution: Record<string, number> = {};
    for (const vid of videoIds) {
      distribution[vid] = 0;
    }

    for (const chunk of retrievedChunks) {
      const count = distribution[chunk.videoId];
      if (count !== undefined) {
        distribution[chunk.videoId] = count + 1;
      }
    }

    if (videoIds.length <= 1) {
      return { isBalanced: true, distribution };
    }

    const counts = Object.values(distribution);
    const maxCount = Math.max(...counts);
    const minCount = Math.min(...counts);

    const maxDifference = maxCount - minCount;

    if (maxDifference > 1) {
      return {
        isBalanced: false,
        distribution,
        reason: `Imbalanced distribution: range between max (${maxCount}) and min (${minCount}) is ${maxDifference}, exceeding threshold of 1.`,
      };
    }

    return { isBalanced: true, distribution };
  }
}
