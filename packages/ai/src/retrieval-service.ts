import { type RetrievalChunk } from '@prisma/client';
import { prisma } from '@rag/db';
import {
  retrievalQuerySchema,
  retrievalQueryRequestSchema,
  retrievalCompareRequestSchema,
  type RetrievalQuery,
  type RetrievalContext,
  type RetrievalResult,
  type RetrievalCitation,
  type RetrievalFilters,
  type RetrievalDiagnostics,
  type RetrievalRankingDiagnostics,
} from '@rag/shared';
import { EmbeddingService } from './embedding-service.js';

export interface RetrievalLogger {
  info(msg: string, meta?: unknown): void;
  warn(msg: string, meta?: unknown): void;
  error(msg: string, meta?: unknown): void;
  debug(msg: string, meta?: unknown): void;
}

const noOpLogger: RetrievalLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

type QueryResultRow = RetrievalChunk & {
  videoTitle: string;
  videoUrl: string;
  creatorName: string | null;
  creatorHandle: string | null;
  videoViews: number;
  similarity: number;
};

interface QueryChunksResult {
  results: RetrievalResult[];
  diagnostics: RetrievalRankingDiagnostics[];
}

export class RetrievalService {
  private logger: RetrievalLogger;
  private embeddingService: EmbeddingService;

  constructor(logger?: RetrievalLogger, embeddingService?: EmbeddingService) {
    this.logger = logger || noOpLogger;
    this.embeddingService = embeddingService || new EmbeddingService(logger);
  }

  /**
   * Main retrieval method that coordinates query validation, search execution,
   * comparative balancing, citation assembly, and LLM context formatting.
   */
  async retrieve(
    rawQuery: unknown,
  ): Promise<RetrievalContext & { diagnostics?: RetrievalDiagnostics }> {
    const startTime = Date.now();
    this.logger.info('Starting retrieval query execution');

    const hasScope = typeof rawQuery === 'object' && rawQuery !== null && 'scope' in rawQuery;
    let parsedQuery: RetrievalQuery;

    if (!hasScope) {
      const parsedQueryReq = retrievalQueryRequestSchema.parse(rawQuery);
      parsedQuery = {
        textQuery: parsedQueryReq.textQuery,
        scope: parsedQueryReq.videoId
          ? { type: 'video', videoId: parsedQueryReq.videoId }
          : { type: 'global' },
        filters: parsedQueryReq.filters,
        limit: parsedQueryReq.limit,
        offset: parsedQueryReq.offset,
      };
    } else {
      parsedQuery = retrievalQuerySchema.parse(rawQuery);
    }

    const { textQuery, scope, filters, limit, offset } = parsedQuery;
    this.logger.debug('Validated retrieval query', { parsedQuery });

    let retrievedChunks: RetrievalResult[] = [];
    let rankingDiagnostics: RetrievalRankingDiagnostics[] = [];
    let comparativeDiagnostics: { distribution: Record<string, number> } | undefined;
    let comparativeBalanced = false;

    if (scope.type === 'comparative') {
      const compResult = await this.retrieveComparative(
        textQuery,
        scope.videoIds,
        filters,
        limit,
        offset,
      );
      retrievedChunks = compResult.results;
      rankingDiagnostics = compResult.diagnostics;
      comparativeDiagnostics = compResult.comparativeDiagnostics;
      comparativeBalanced = true;
    } else {
      const queryResult = await this.queryChunks(textQuery, scope, filters, limit, offset);
      retrievedChunks = queryResult.results;
      rankingDiagnostics = queryResult.diagnostics;
    }

    // Group context results by videoId
    const groupedContext: Record<string, RetrievalResult[]> = {};
    for (const result of retrievedChunks) {
      if (!groupedContext[result.videoId]) {
        groupedContext[result.videoId] = [];
      }
      groupedContext[result.videoId]!.push(result);
    }

    const formattedContextString = this.formatContextString(retrievedChunks);

    const unreadyChunks = retrievedChunks.filter(
      (c) => !c.text || c.tokenCount > 512 || !c.citation.videoId,
    );
    if (unreadyChunks.length > 0) {
      this.logger.warn('Some retrieved chunks are not fully embedding-ready', {
        unreadyCount: unreadyChunks.length,
        unreadyChunks: unreadyChunks.map((c) => ({
          chunkIndex: c.chunkIndex,
          tokenCount: c.tokenCount,
          hasText: !!c.text,
        })),
      });
    }

    const totalTokens = retrievedChunks.reduce(
      (sum: number, chunk: RetrievalResult) => sum + chunk.tokenCount,
      0,
    );
    const totalChars = formattedContextString.length;
    const executionTimeMs = Date.now() - startTime;

    this.logger.info('Completed retrieval query execution', {
      executionTimeMs,
      totalChunks: retrievedChunks.length,
      totalTokens,
      totalChars,
      videoIds: Object.keys(groupedContext),
    });

    const queryVectorGenerated = true;

    const diagnostics: RetrievalDiagnostics = {
      executionTimeMs,
      queryVectorGenerated,
      rankingDiagnostics,
      ...(comparativeDiagnostics ? { comparativeDiagnostics } : {}),
    };

    return {
      rawQuery: textQuery,
      retrievedChunks,
      groupedContext,
      formattedContextString,
      metadata: {
        totalChunks: retrievedChunks.length,
        executionTimeMs,
        comparativeBalanced,
      },
      diagnostics,
    };
  }

  async retrieveCompare(
    rawQuery: unknown,
  ): Promise<RetrievalContext & { diagnostics?: RetrievalDiagnostics }> {
    const parsed = retrievalCompareRequestSchema.parse(rawQuery);
    const mappedQuery = {
      textQuery: parsed.textQuery,
      scope: {
        type: 'comparative' as const,
        videoIds: parsed.videoIds,
      },
      filters: parsed.filters,
      limit: parsed.limit,
      offset: parsed.offset,
    };
    return this.retrieve(mappedQuery);
  }

  private async retrieveComparative(
    textQuery: string,
    videoIds: string[],
    filters: RetrievalFilters | undefined,
    limit: number,
    offset: number,
  ): Promise<{
    results: RetrievalResult[];
    diagnostics: RetrievalRankingDiagnostics[];
    comparativeDiagnostics: { distribution: Record<string, number> };
  }> {
    if (videoIds.length === 0) {
      return {
        results: [],
        diagnostics: [],
        comparativeDiagnostics: { distribution: {} },
      };
    }

    this.logger.info('Executing comparative retrieval balancing', {
      videoCount: videoIds.length,
      limit,
      offset,
    });

    const candidatesPerVideo: RetrievalResult[][] = [];
    const diagnosticsPerVideo: RetrievalRankingDiagnostics[][] = [];

    const fetchLimit = limit + offset;
    for (const videoId of videoIds) {
      const queryResult = await this.queryChunks(
        textQuery,
        { type: 'video', videoId },
        filters,
        fetchLimit,
        0,
      );
      candidatesPerVideo.push(queryResult.results);
      diagnosticsPerVideo.push(queryResult.diagnostics);
    }

    const balancedResults: RetrievalResult[] = [];
    const balancedDiagnostics: RetrievalRankingDiagnostics[] = [];

    let added = true;
    let index = 0;
    while (added && balancedResults.length < fetchLimit) {
      added = false;
      for (let vIdx = 0; vIdx < videoIds.length; vIdx++) {
        const resultsList = candidatesPerVideo[vIdx]!;
        const diagList = diagnosticsPerVideo[vIdx]!;
        if (index < resultsList.length) {
          balancedResults.push(resultsList[index]!);
          balancedDiagnostics.push(diagList[index]!);
          added = true;
        }
      }
      index++;
    }

    const slicedResults = balancedResults.slice(offset, offset + limit);
    const slicedDiagnostics = balancedDiagnostics.slice(offset, offset + limit);

    const distribution: Record<string, number> = {};
    for (const videoId of videoIds) {
      distribution[videoId] = 0;
    }
    for (const res of slicedResults) {
      distribution[res.videoId] = (distribution[res.videoId] || 0) + 1;
    }

    this.logger.info('Comparative balancing complete', { distribution });

    return {
      results: slicedResults,
      diagnostics: slicedDiagnostics,
      comparativeDiagnostics: { distribution },
    };
  }

  private async queryChunks(
    textQuery: string,
    scope: { type: 'video'; videoId: string } | { type: 'global' },
    filters: RetrievalFilters | undefined,
    limit: number,
    offset: number,
  ): Promise<QueryChunksResult> {
    const queryStartTime = Date.now();
    this.logger.debug('Building database pgvector query', { scope, filters, limit, offset });

    const queryVector = await this.embeddingService.generateQueryEmbedding(textQuery);
    const vectorStr = `[${queryVector.join(',')}]`;

    const whereClauses: string[] = ['rc.embedding IS NOT NULL'];
    const params: unknown[] = [vectorStr];
    let paramIndex = 2;

    if (scope.type === 'video') {
      whereClauses.push(`rc."videoId" = $${paramIndex}`);
      params.push(scope.videoId);
      paramIndex++;
    }

    if (filters) {
      if (filters.providers && filters.providers.length > 0) {
        const placeholders = filters.providers.map(() => `$${paramIndex++}`);
        whereClauses.push(`v.platform IN (${placeholders.join(', ')})`);
        params.push(...filters.providers);
      }
      if (filters.creators && filters.creators.length > 0) {
        const creatorClauses: string[] = [];
        for (const creator of filters.creators) {
          const p1 = paramIndex++;
          const p2 = paramIndex++;
          creatorClauses.push(`v."creatorName" = $${p1} OR v."creatorHandle" = $${p2}`);
          params.push(creator, creator);
        }
        whereClauses.push(`(${creatorClauses.join(' OR ')})`);
      }
      if (filters.ingestionStatuses && filters.ingestionStatuses.length > 0) {
        const placeholders = filters.ingestionStatuses.map(
          () => `$${paramIndex++}::"IngestionStatus"`,
        );
        whereClauses.push(`v."ingestionStatus" IN (${placeholders.join(', ')})`);
        params.push(...filters.ingestionStatuses);
      }
      if (filters.transcriptSources && filters.transcriptSources.length > 0) {
        const placeholders = filters.transcriptSources.map(() => `$${paramIndex++}`);
        whereClauses.push(`rc."transcriptSource" IN (${placeholders.join(', ')})`);
        params.push(...filters.transcriptSources);
      }
      if (filters.confidenceThreshold !== undefined) {
        whereClauses.push(`1 - (rc.embedding <=> $1::vector) >= $${paramIndex}`);
        params.push(filters.confidenceThreshold);
        paramIndex++;
      }
      if (filters.maxStartSeconds !== undefined) {
        whereClauses.push(`rc."startSeconds" <= $${paramIndex}`);
        params.push(filters.maxStartSeconds);
        paramIndex++;
      }
    }

    // Only compare against vectors from the current active provider
    whereClauses.push(`rc."embeddingProvider" = $${paramIndex}`);
    params.push(this.embeddingService.getProviderName());
    paramIndex++;

    const whereSql = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';

    const querySql = `
      SELECT 
        rc.id,
        rc."videoId",
        rc."chunkIndex",
        rc.text,
        rc."tokenCount",
        rc."startSeconds",
        rc."endSeconds",
        rc."transcriptSegmentStart",
        rc."transcriptSegmentEnd",
        rc."transcriptSource",
        v.title as "videoTitle",
        v."canonicalUrl" as "videoUrl",
        v."creatorName" as "creatorName",
        v."creatorHandle" as "creatorHandle",
        v.views as "videoViews",
        1 - (rc.embedding <=> $1::vector) as similarity
      FROM "RetrievalChunk" rc
      INNER JOIN "Video" v ON rc."videoId" = v.id
      ${whereSql}
      ORDER BY similarity DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    params.push(limit, offset);

    this.logger.debug('Executing pgvector similarity search raw SQL query');
    const rows = await prisma.$queryRawUnsafe<QueryResultRow[]>(querySql, ...params);
    const dbDuration = Date.now() - queryStartTime;
    this.logger.debug('pgvector search query executed', {
      rowsCount: rows.length,
      durationMs: dbDuration,
    });

    const results: RetrievalResult[] = [];
    const diagnostics: RetrievalRankingDiagnostics[] = [];

    for (const row of rows) {
      // Clamped cosine similarity (70% weight)
      const similarityScore = Math.max(0, Math.min(1, row.similarity));

      let transcriptConfidenceScore = 0.8;
      const sourceLower = row.transcriptSource.toLowerCase();
      if (sourceLower === 'native') {
        transcriptConfidenceScore = 1.0;
      } else if (sourceLower === 'extracted') {
        transcriptConfidenceScore = 0.9;
      }

      const views = row.videoViews || 0;
      const logViews = views > 0 ? Math.log10(views) : 0;
      const normalizedViewsScore = Math.min(1.0, logViews / 7.0);

      const semanticWeighted = similarityScore * 0.7;
      const transcriptWeighted = transcriptConfidenceScore * 0.2;
      const viewsWeighted = normalizedViewsScore * 0.1;
      const finalScore = semanticWeighted + transcriptWeighted + viewsWeighted;

      const citation = this.assembleCitationFromRow(row);

      results.push({
        chunkId: row.id,
        videoId: row.videoId,
        chunkIndex: row.chunkIndex,
        text: row.text,
        tokenCount: row.tokenCount,
        score: finalScore,
        citation,
      });

      diagnostics.push({
        chunkId: row.id,
        videoId: row.videoId,
        scoreBreakdown: {
          semanticSimilarity: semanticWeighted,
          transcriptConfidence: transcriptWeighted,
          engagementWeight: viewsWeighted,
        },
        rawScores: {
          semanticSimilarity: row.similarity,
          transcriptConfidence: transcriptConfidenceScore,
          engagementWeight: normalizedViewsScore,
        },
      });
    }

    const sortedIndices = results
      .map((result: RetrievalResult, index: number) => ({
        r: result,
        diag: diagnostics[index]!,
        score: result.score,
      }))
      .sort((a, b) => b.score - a.score);

    const sortedResults = sortedIndices.map((entry) => entry.r);
    const sortedDiagnostics = sortedIndices.map((entry) => entry.diag);

    return {
      results: sortedResults,
      diagnostics: sortedDiagnostics,
    };
  }

  private assembleCitationFromRow(row: QueryResultRow): RetrievalCitation {
    return {
      videoId: row.videoId,
      videoTitle: row.videoTitle,
      videoUrl: row.videoUrl,
      creatorName: row.creatorName,
      creatorHandle: row.creatorHandle,
      startSeconds: row.startSeconds,
      endSeconds: row.endSeconds,
      chunkId: row.id,
      transcriptSegmentStart: row.transcriptSegmentStart,
      transcriptSegmentEnd: row.transcriptSegmentEnd,
      transcriptSource: row.transcriptSource,
    };
  }

  private formatContextString(results: RetrievalResult[]): string {
    if (results.length === 0) {
      return 'No relevant video context found.';
    }

    return results
      .map((result: RetrievalResult, index: number) => {
        const cite = result.citation;
        const creatorInfo = cite.creatorName
          ? ` (Creator: ${cite.creatorName}${cite.creatorHandle ? ` / @${cite.creatorHandle}` : ''})`
          : '';
        const timeStart = this.formatTimestamp(cite.startSeconds);
        const timeEnd = this.formatTimestamp(cite.endSeconds);

        return `[Context Reference ${index + 1}]
Video Source: "${cite.videoTitle}"${creatorInfo}
URL: ${cite.videoUrl}
Time Segment: ${timeStart} - ${timeEnd} (Seconds: ${cite.startSeconds.toFixed(1)}s - ${cite.endSeconds.toFixed(1)}s)
Transcript Provenance: ${cite.transcriptSource} (Segments ${cite.transcriptSegmentStart} to ${cite.transcriptSegmentEnd})
Relevance Confidence Score: ${(result.score * 100).toFixed(1)}%
Content excerpt:
"""
${result.text.trim()}
"""`;
      })
      .join('\n\n---\n\n');
  }

  private formatTimestamp(totalSeconds: number): string {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = Math.floor(totalSeconds % 60);

    const pad = (n: number): string => String(n).padStart(2, '0');

    if (hours > 0) {
      return `${hours}:${pad(minutes)}:${pad(seconds)}`;
    }
    return `${minutes}:${pad(seconds)}`;
  }
}
