import 'dotenv/config';
import { prisma } from '@rag/db';
import { EmbeddingService } from '@rag/ai';

async function main(): Promise<void> {
  console.log('--- Embedding Provider Migration & Regeneration Tool ---');

  // We instantiate the embedding service just to log the CURRENT provider.
  // The actual processing is handled by the ingestion-worker pulling from the DB.
  const embeddingService = new EmbeddingService();
  const provider = embeddingService.getProviderName();
  const model = embeddingService.getModelName();

  console.log(`[INFO] Current Active Provider: ${provider}`);
  console.log(`[INFO] Current Active Model: ${model}`);
  console.log(
    `[WARN] This action will clear all existing embedding vectors and force the ingestion worker to regenerate them using '${provider}'.`,
  );

  // Wait 3 seconds to allow user to cancel if needed
  console.log('Starting in 3 seconds... (Ctrl+C to cancel)');
  await new Promise((resolve) => setTimeout(resolve, 3000));

  try {
    console.log('[INFO] Starting database updates...');

    // 1. Reset all VideoEmbeddingState statuses back to 'PENDING'
    const resetStates = await prisma.videoEmbeddingState.updateMany({
      data: {
        status: 'PENDING',
        errorMessage: null,
      },
    });
    console.log(`[OK] Reset ${resetStates.count} video embedding states to PENDING.`);

    // 2. Clear all RetrievalChunk.embedding fields to free up memory and prevent accidental use
    const clearVectors = await prisma.$executeRawUnsafe(`
      UPDATE "RetrievalChunk" SET embedding = NULL
    `);
    console.log(`[OK] Cleared vectors from ${clearVectors} retrieval chunks.`);

    console.log('[OK] Regeneration triggered successfully.');
    console.log(
      '[INFO] The ingestion worker will automatically pick up the PENDING states and generate new vectors shortly.',
    );
  } catch (error) {
    console.error('[ERROR] Migration failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
