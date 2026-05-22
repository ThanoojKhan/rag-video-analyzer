import { z } from 'zod';

const envBooleanSchema = z.preprocess((value) => {
  if (typeof value !== 'string') {
    return value;
  }

  if (value.toLowerCase() === 'true') {
    return true;
  }

  if (value.toLowerCase() === 'false') {
    return false;
  }

  return value;
}, z.boolean());

export const appEnvSchema = z
  .object({
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    PORT_FALLBACK: envBooleanSchema.default(false),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),
    CORS_ORIGIN: z.string().url().optional(),
    NEXT_PUBLIC_API_BASE_URL: z.string().url().optional(),
    GOOGLE_API_KEY: z.string().optional(),
  })
  .superRefine((env, context) => {
    if (env.NODE_ENV === 'production' && !env.CORS_ORIGIN) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CORS_ORIGIN'],
        message: 'CORS_ORIGIN is required in production.',
      });
    }
  });

export type AppEnv = z.infer<typeof appEnvSchema>;

export const workerEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  GOOGLE_API_KEY: z.string().optional(),
});

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  uptimeSeconds: z.number().nonnegative(),
  timestamp: z.string().datetime(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const chunkingConfigSchema = z.object({
  maxTokens: z.number().int().positive().default(500),
  overlapTokens: z.number().int().nonnegative().default(50),
  minChunkSize: z.number().int().nonnegative().default(100),
  timeGapThresholdSeconds: z.number().positive().default(3.0),
});

export type ChunkingConfig = z.infer<typeof chunkingConfigSchema>;

export * from './retrieval-contracts.js';
export * from './errors.js';
