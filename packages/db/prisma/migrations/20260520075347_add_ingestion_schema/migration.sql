/*
  Warnings:

  - You are about to drop the column `metadata` on the `Video` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[canonicalUrl]` on the table `Video` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[platform,platformVideoId]` on the table `Video` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `canonicalUrl` to the `Video` table without a default value. This is not possible if the table is not empty.
  - Added the required column `platform` to the `Video` table without a default value. This is not possible if the table is not empty.
  - Added the required column `platformVideoId` to the `Video` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `Video` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "IngestionStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'RETRYING');

-- CreateEnum
CREATE TYPE "TranscriptSourceType" AS ENUM ('NATIVE', 'EXTRACTED', 'GENERATED');

-- AlterTable
ALTER TABLE "Video" DROP COLUMN "metadata",
ADD COLUMN     "canonicalUrl" TEXT NOT NULL,
ADD COLUMN     "comments" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "creatorHandle" TEXT,
ADD COLUMN     "creatorName" TEXT,
ADD COLUMN     "durationSeconds" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "engagementRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "followerCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "hashtags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "ingestionStatus" "IngestionStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "lastIngestedAt" TIMESTAMP(3),
ADD COLUMN     "likes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "platform" TEXT NOT NULL,
ADD COLUMN     "platformVideoId" TEXT NOT NULL,
ADD COLUMN     "thumbnailUrl" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "uploadDate" TIMESTAMP(3),
ADD COLUMN     "views" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "TranscriptSegment" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "sequenceIndex" INTEGER NOT NULL,
    "startSeconds" DOUBLE PRECISION NOT NULL,
    "endSeconds" DOUBLE PRECISION NOT NULL,
    "text" TEXT NOT NULL,
    "sourceType" "TranscriptSourceType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TranscriptSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngestionJob" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" "IngestionStatus" NOT NULL,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "failureReason" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IngestionJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TranscriptSegment_videoId_idx" ON "TranscriptSegment"("videoId");

-- CreateIndex
CREATE INDEX "TranscriptSegment_sourceType_idx" ON "TranscriptSegment"("sourceType");

-- CreateIndex
CREATE UNIQUE INDEX "TranscriptSegment_videoId_sequenceIndex_key" ON "TranscriptSegment"("videoId", "sequenceIndex");

-- CreateIndex
CREATE INDEX "IngestionJob_videoId_idx" ON "IngestionJob"("videoId");

-- CreateIndex
CREATE INDEX "IngestionJob_status_idx" ON "IngestionJob"("status");

-- CreateIndex
CREATE INDEX "IngestionJob_provider_idx" ON "IngestionJob"("provider");

-- CreateIndex
CREATE INDEX "IngestionJob_createdAt_idx" ON "IngestionJob"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Video_canonicalUrl_key" ON "Video"("canonicalUrl");

-- CreateIndex
CREATE INDEX "Video_platform_idx" ON "Video"("platform");

-- CreateIndex
CREATE INDEX "Video_ingestionStatus_idx" ON "Video"("ingestionStatus");

-- CreateIndex
CREATE INDEX "Video_createdAt_idx" ON "Video"("createdAt");

-- CreateIndex
CREATE INDEX "Video_lastIngestedAt_idx" ON "Video"("lastIngestedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Video_platform_platformVideoId_key" ON "Video"("platform", "platformVideoId");

-- AddForeignKey
ALTER TABLE "TranscriptSegment" ADD CONSTRAINT "TranscriptSegment_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestionJob" ADD CONSTRAINT "IngestionJob_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "Video"("id") ON DELETE CASCADE ON UPDATE CASCADE;
