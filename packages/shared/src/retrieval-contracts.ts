import { z } from 'zod';

export const videoScopedRetrievalSchema = z.object({
  type: z.literal('video'),
  videoId: z.string(),
});
export type VideoScopedRetrieval = z.infer<typeof videoScopedRetrievalSchema>;

export const comparativeRetrievalSchema = z.object({
  type: z.literal('comparative'),
  videoIds: z.array(z.string()),
});
export type ComparativeRetrieval = z.infer<typeof comparativeRetrievalSchema>;

export const globalRetrievalSchema = z.object({
  type: z.literal('global'),
});
export type GlobalRetrieval = z.infer<typeof globalRetrievalSchema>;

export const retrievalFiltersSchema = z.object({
  providers: z.array(z.string()).optional(),
  creators: z.array(z.string()).optional(),
  transcriptSources: z.array(z.string()).optional(),
  ingestionStatuses: z
    .array(z.enum(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'RETRYING']))
    .optional(),
  confidenceThreshold: z.number().min(0).max(1).optional(),
  maxStartSeconds: z.number().optional(),
});
export type RetrievalFilters = z.infer<typeof retrievalFiltersSchema>;

export const retrievalQuerySchema = z.object({
  textQuery: z.string(),
  scope: z.discriminatedUnion('type', [
    videoScopedRetrievalSchema,
    comparativeRetrievalSchema,
    globalRetrievalSchema,
  ]),
  filters: retrievalFiltersSchema.optional(),
  limit: z.number().int().positive().default(10),
  offset: z.number().int().nonnegative().default(0),
  options: z
    .object({
      enableReranking: z.boolean().default(false),
      enableHybridSearch: z.boolean().default(false),
    })
    .optional(),
});
export type RetrievalQuery = z.infer<typeof retrievalQuerySchema>;

export const retrievalCitationSchema = z.object({
  videoId: z.string(),
  videoTitle: z.string(),
  videoUrl: z.string(),
  creatorName: z.string().nullable().optional(),
  creatorHandle: z.string().nullable().optional(),
  startSeconds: z.number(),
  endSeconds: z.number(),
  chunkId: z.string(),
  transcriptSegmentStart: z.number(),
  transcriptSegmentEnd: z.number(),
  transcriptSource: z.string(),
});
export type RetrievalCitation = z.infer<typeof retrievalCitationSchema>;

export const retrievalResultSchema = z.object({
  chunkId: z.string(),
  videoId: z.string(),
  chunkIndex: z.number(),
  text: z.string(),
  tokenCount: z.number(),
  score: z.number(),
  citation: retrievalCitationSchema,
});
export type RetrievalResult = z.infer<typeof retrievalResultSchema>;

export const retrievalContextSchema = z.object({
  rawQuery: z.string(),
  retrievedChunks: z.array(retrievalResultSchema),
  groupedContext: z.record(z.string(), z.array(retrievalResultSchema)),
  formattedContextString: z.string(),
  metadata: z.object({
    totalChunks: z.number(),
    executionTimeMs: z.number(),
    comparativeBalanced: z.boolean(),
  }),
});
export type RetrievalContext = z.infer<typeof retrievalContextSchema>;

export const chunkDiagnosticDetailSchema = z.object({
  chunkIndex: z.number(),
  textPreview: z.string(),
  tokenCount: z.number(),
  wordCount: z.number(),
  startSeconds: z.number(),
  endSeconds: z.number(),
  segmentStart: z.number(),
  segmentEnd: z.number(),
  semanticCoherenceScore: z.number(),
  coherenceDetails: z.object({
    endsWithPunctuation: z.boolean(),
    hasTimeGapBoundary: z.boolean(),
    splitsSentence: z.boolean(),
  }),
  overlapWithPrevious: z
    .object({
      tokens: z.number(),
      words: z.number(),
      segments: z.number(),
    })
    .nullable(),
  continuityWithPrevious: z
    .object({
      gapSeconds: z.number(),
      hasOverlap: z.boolean(),
    })
    .nullable(),
});

export type ChunkDiagnosticDetail = z.infer<typeof chunkDiagnosticDetailSchema>;

export const chunkQualityReportSchema = z.object({
  videoId: z.string(),
  videoTitle: z.string(),
  totalSegments: z.number(),
  totalChunks: z.number(),
  metrics: z.object({
    averageChunkTokens: z.number(),
    averageChunkWords: z.number(),
    averageOverlapTokens: z.number(),
    orphanedSegmentCount: z.number(),
    orphanedSegmentIndices: z.array(z.number()),
    emptyOrLowQualityCount: z.number(),
    lowQualityChunkIndices: z.array(z.number()),
  }),
  chunkDiagnostics: z.array(chunkDiagnosticDetailSchema),
  validationReport: z.object({
    citationTraceabilityValid: z.boolean(),
    timestampPreservationValid: z.boolean(),
    chunkContinuityValid: z.boolean(),
    issues: z.array(z.string()),
  }),
});

export type ChunkQualityReport = z.infer<typeof chunkQualityReportSchema>;

export const videoStatusResponseSchema = z.object({
  videoId: z.string(),
  ingestionStatus: z.enum(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'RETRYING']),
  embeddingStatus: z.enum(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED']).nullable(),
  chunksProcessed: z.number().nullable(),
  totalChunks: z.number().nullable(),
  overallProgress: z.number(),
});
export type VideoStatusResponse = z.infer<typeof videoStatusResponseSchema>;

export const retrievalQueryRequestSchema = z.object({
  textQuery: z.string().min(1, 'Query text cannot be empty'),
  videoId: z.string().optional(),
  filters: retrievalFiltersSchema.optional(),
  limit: z.number().int().positive().default(10),
  offset: z.number().int().nonnegative().default(0),
});
export type RetrievalQueryRequest = z.infer<typeof retrievalQueryRequestSchema>;

export const retrievalCompareRequestSchema = z.object({
  textQuery: z.string().min(1, 'Query text cannot be empty'),
  videoIds: z.array(z.string()).min(2, 'Must provide at least two video IDs to compare'),
  filters: retrievalFiltersSchema.optional(),
  limit: z.number().int().positive().default(10),
  offset: z.number().int().nonnegative().default(0),
});
export type RetrievalCompareRequest = z.infer<typeof retrievalCompareRequestSchema>;

export const retrievalRankingDiagnosticsSchema = z.object({
  chunkId: z.string(),
  videoId: z.string(),
  scoreBreakdown: z.object({
    semanticSimilarity: z.number(),
    transcriptConfidence: z.number(),
    engagementWeight: z.number(),
  }),
  rawScores: z.object({
    semanticSimilarity: z.number(),
    transcriptConfidence: z.number(),
    engagementWeight: z.number(),
  }),
});
export type RetrievalRankingDiagnostics = z.infer<typeof retrievalRankingDiagnosticsSchema>;

export const retrievalDiagnosticsSchema = z.object({
  executionTimeMs: z.number(),
  queryVectorGenerated: z.boolean(),
  rankingDiagnostics: z.array(retrievalRankingDiagnosticsSchema),
  comparativeDiagnostics: z
    .object({
      distribution: z.record(z.string(), z.number()),
    })
    .optional(),
});
export type RetrievalDiagnostics = z.infer<typeof retrievalDiagnosticsSchema>;

export const retrievalQueryResponseSchema = z.object({
  success: z.boolean(),
  results: z.array(retrievalResultSchema),
  context: retrievalContextSchema,
  diagnostics: retrievalDiagnosticsSchema.optional(),
});
export type RetrievalQueryResponse = z.infer<typeof retrievalQueryResponseSchema>;

export const evaluationScenarioSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.enum([
    'hook_analysis',
    'emotional_engagement',
    'creator_comparison',
    'cta_analysis',
    'pacing_style',
  ]),
  textQuery: z.string(),
  videoIds: z.array(z.string()).optional(),
  expectedMinScore: z.number().optional(),
});
export type EvaluationScenario = z.infer<typeof evaluationScenarioSchema>;

export const retrievalEvaluationReportSchema = z.object({
  query: z.string(),
  metrics: z.object({
    averageRetrievalScore: z.number(),
    retrievalLatencyMs: z.number(),
    precision: z.number(),
    diversityScore: z.number(),
    citationIntegrityScore: z.number(),
    comparativeBalanceScore: z.number(),
  }),
  failureAnalysis: z.object({
    lowConfidenceCount: z.number(),
    repetitiveChunkCount: z.number(),
    overDominantVideoCount: z.number(),
    poorCitationTraceabilityCount: z.number(),
    lowDiversityDetected: z.boolean(),
  }),
  chunkDistribution: z.record(z.string(), z.number()),
  rankingFactorContributions: z.object({
    semanticSimilarityAvg: z.number(),
    transcriptConfidenceAvg: z.number(),
    engagementWeightAvg: z.number(),
  }),
  degradationIndicators: z.array(z.string()),
});
export type RetrievalEvaluationReport = z.infer<typeof retrievalEvaluationReportSchema>;

export const scenarioEvaluationResultSchema = z.object({
  scenario: evaluationScenarioSchema,
  report: retrievalEvaluationReportSchema.optional(),
  passed: z.boolean(),
  error: z.string().optional(),
});
export type ScenarioEvaluationResult = z.infer<typeof scenarioEvaluationResultSchema>;

export const bulkEvaluationReportSchema = z.object({
  timestamp: z.string(),
  totalScenarios: z.number(),
  passedScenarios: z.number(),
  failedScenarios: z.number(),
  averageLatencyMs: z.number(),
  results: z.array(scenarioEvaluationResultSchema),
  globalDegradationIndicators: z.array(z.string()),
});
export type BulkEvaluationReport = z.infer<typeof bulkEvaluationReportSchema>;

// ─── Phase 6: Chat / Orchestration Contracts ────────────────────────────────

export const analysisTypeSchema = z.enum([
  'comparative',
  'hook_analysis',
  'engagement',
  'cta',
  'pacing',
  'general',
]);
export type AnalysisType = z.infer<typeof analysisTypeSchema>;

export const chatCitationSchema = z.object({
  refIndex: z.number(), // [REF-N] marker index
  videoId: z.string(),
  videoTitle: z.string(),
  videoUrl: z.string(),
  creatorName: z.string().nullable().optional(),
  startSeconds: z.number(),
  endSeconds: z.number(),
  chunkId: z.string(),
  transcriptSource: z.string(),
  relevanceScore: z.number(),
});
export type ChatCitation = z.infer<typeof chatCitationSchema>;

export const chatMessageSchema = z.object({
  turnId: z.string(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  citations: z.array(chatCitationSchema).optional(),
  createdAt: z.string(),
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const conversationMemorySchema = z.object({
  conversationId: z.string(),
  videoIds: z.array(z.string()),
  analysisType: analysisTypeSchema,
  turns: z.array(chatMessageSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ConversationMemory = z.infer<typeof conversationMemorySchema>;

export const chatRequestSchema = z.object({
  message: z.string().min(1, 'Message cannot be empty'),
  conversationId: z.string().optional(),
  videoIds: z.array(z.string()).default([]),
  analysisType: analysisTypeSchema.default('general'),
  stream: z.boolean().default(false),
  limit: z.number().int().positive().default(8),
});
export type ChatRequest = z.infer<typeof chatRequestSchema>;

export const chatResponseSchema = z.object({
  conversationId: z.string(),
  turnId: z.string(),
  answer: z.string(),
  citations: z.array(chatCitationSchema),
  analysisType: analysisTypeSchema,
  latencyMs: z.number(),
  retrievalContext: retrievalContextSchema.optional(),
  orchestrationTimings: z.record(z.string(), z.number()).optional(),
});
export type ChatResponse = z.infer<typeof chatResponseSchema>;

export const streamingTokenEventSchema = z.object({
  type: z.literal('token'),
  content: z.string(),
});

export const streamingCitationEventSchema = z.object({
  type: z.literal('citation'),
  citation: chatCitationSchema,
});

export const streamingDoneEventSchema = z.object({
  type: z.literal('done'),
  conversationId: z.string(),
  turnId: z.string(),
  latencyMs: z.number(),
  citations: z.array(chatCitationSchema),
});

export const streamingErrorEventSchema = z.object({
  type: z.literal('error'),
  message: z.string(),
  code: z.string().optional(),
});

export const streamingEventSchema = z.discriminatedUnion('type', [
  streamingTokenEventSchema,
  streamingCitationEventSchema,
  streamingDoneEventSchema,
  streamingErrorEventSchema,
]);
export type StreamingEvent = z.infer<typeof streamingEventSchema>;

export const conversationListItemSchema = z.object({
  conversationId: z.string(),
  videoIds: z.array(z.string()),
  analysisType: analysisTypeSchema,
  turnCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ConversationListItem = z.infer<typeof conversationListItemSchema>;
