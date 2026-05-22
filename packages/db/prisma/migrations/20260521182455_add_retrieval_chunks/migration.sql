-- CreateEnum
CREATE TYPE "EmbeddingStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "RetrievalChunk" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "ingestionJobId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "tokenCount" INTEGER NOT NULL,
    "startSeconds" DOUBLE PRECISION NOT NULL,
    "endSeconds" DOUBLE PRECISION NOT NULL,
    "transcriptSegmentStart" INTEGER NOT NULL,
    "transcriptSegmentEnd" INTEGER NOT NULL,
    "embeddingModel" TEXT NOT NULL,
    "metadataSource" TEXT NOT NULL,
    "transcriptSource" TEXT NOT NULL,
    "embedding" vector(1536),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RetrievalChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoEmbeddingState" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "ingestionJobId" TEXT NOT NULL,
    "status" "EmbeddingStatus" NOT NULL DEFAULT 'PENDING',
    "model" TEXT NOT NULL,
    "chunkCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoEmbeddingState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RetrievalChunk_videoId_idx" ON "RetrievalChunk"("videoId");

-- CreateIndex
CREATE INDEX "RetrievalChunk_ingestionJobId_idx" ON "RetrievalChunk"("ingestionJobId");

-- CreateIndex
CREATE UNIQUE INDEX "RetrievalChunk_videoId_chunkIndex_key" ON "RetrievalChunk"("videoId", "chunkIndex");

-- CreateIndex
CREATE UNIQUE INDEX "VideoEmbeddingState_videoId_key" ON "VideoEmbeddingState"("videoId");

-- CreateIndex
CREATE INDEX "VideoEmbeddingState_videoId_idx" ON "VideoEmbeddingState"("videoId");

-- CreateIndex
CREATE INDEX "VideoEmbeddingState_ingestionJobId_idx" ON "VideoEmbeddingState"("ingestionJobId");

-- CreateIndex
CREATE INDEX "VideoEmbeddingState_status_idx" ON "VideoEmbeddingState"("status");

-- AddForeignKey
ALTER TABLE "RetrievalChunk" ADD CONSTRAINT "RetrievalChunk_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetrievalChunk" ADD CONSTRAINT "RetrievalChunk_ingestionJobId_fkey" FOREIGN KEY ("ingestionJobId") REFERENCES "IngestionJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoEmbeddingState" ADD CONSTRAINT "VideoEmbeddingState_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoEmbeddingState" ADD CONSTRAINT "VideoEmbeddingState_ingestionJobId_fkey" FOREIGN KEY ("ingestionJobId") REFERENCES "IngestionJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
