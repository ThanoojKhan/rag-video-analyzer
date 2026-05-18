import { describe, expect, it } from 'vitest';
import { prisma, preparePgVector } from './index';

describe('database package boundary', () => {
  it('exports a singleton Prisma client and pgvector preparation helper', () => {
    expect(prisma).toBeDefined();
    expect(preparePgVector).toEqual(expect.any(Function));
  });

  it.runIf(process.env.RUN_DB_SMOKE === 'true')('connects to the configured database', async () => {
    await prisma.$connect();
    await expect(prisma.video.count()).resolves.toEqual(expect.any(Number));
    await prisma.$disconnect();
  });
});
