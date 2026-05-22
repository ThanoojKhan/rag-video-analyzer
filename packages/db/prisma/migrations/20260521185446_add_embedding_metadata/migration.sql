-- AlterTable
ALTER TABLE "RetrievalChunk" ADD COLUMN     "embeddingGeneratedAt" TIMESTAMP(3),
ADD COLUMN     "embeddingProvider" TEXT,
ADD COLUMN     "embeddingVersion" TEXT,
ADD COLUMN     "vectorDimensions" INTEGER;

-- AlterTable
ALTER TABLE "VideoEmbeddingState" ADD COLUMN     "embeddingGeneratedAt" TIMESTAMP(3),
ADD COLUMN     "embeddingProvider" TEXT,
ADD COLUMN     "embeddingVersion" TEXT,
ADD COLUMN     "vectorDimensions" INTEGER;
