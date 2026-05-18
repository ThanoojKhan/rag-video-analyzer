import { appEnvSchema, type AppEnv } from '@rag/shared';

export function getAppEnv(): AppEnv {
  const result = appEnvSchema.safeParse(process.env);
  if (!result.success) {
    throw new Error(`Environment validation failed: ${JSON.stringify(result.error.format())}`);
  }

  return result.data;
}
