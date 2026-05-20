'use client';

import { useState } from 'react';
import { IngestionForm, IngestionStatus, VideoMetadataPreview, TranscriptPreview } from '@rag/ui';
import {
  ApiClientError,
  fetchIngestionJob,
  fetchTranscript,
  fetchVideo,
  formatApiError,
  ingestVideo,
  IngestionJob,
  TranscriptSegment,
  VideoDetails,
} from '../lib/api-client';

export function IngestionPage(): JSX.Element {
  const [isLoading, setIsLoading] = useState(false);
  const [ingestedVideo, setIngestedVideo] = useState<VideoDetails | null>(null);
  const [transcriptSegments, setTranscriptSegments] = useState<TranscriptSegment[]>([]);
  const [ingestionJob, setIngestionJob] = useState<IngestionJob | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleIngest = async (
    url: string,
    options: { refreshMetadata?: boolean; skipTranscript?: boolean },
  ): Promise<void> => {
    if (isLoading) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const ingestData = await ingestVideo({
        url,
        refreshMetadata: options.refreshMetadata,
        skipTranscript: options.skipTranscript,
      });

      const videoData = await fetchVideo(ingestData.videoId);
      setIngestedVideo(videoData);

      const transcriptData = await fetchTranscript(ingestData.videoId);
      setTranscriptSegments(transcriptData.segments || []);

      if (ingestData.jobId) {
        const jobData = await fetchIngestionJob(ingestData.jobId);
        setIngestionJob(jobData);
      } else {
        setIngestionJob(null);
      }
    } catch (err) {
      setError(formatApiError(err));
      if (err instanceof ApiClientError) {
        console.error('Ingestion API request failed', {
          message: err.message,
          status: err.status,
          configuredBaseUrl: err.payload?.configuredBaseUrl,
          requestUrl: err.url,
          payload: err.payload,
        });
      } else {
        console.error('Ingestion request failed', err);
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-12 text-slate-100">
      <div className="mx-auto max-w-6xl space-y-8">
        {/* Header */}
        <div className="space-y-2">
          <h1 className="text-4xl font-bold">Video Ingestion</h1>
          <p className="text-slate-400">
            Add videos from YouTube, Instagram, or TikTok for analysis
          </p>
        </div>

        <div className="grid gap-8 lg:grid-cols-3">
          {/* Ingestion form */}
          <div className="lg:col-span-1">
            <div className="bg-slate-900 border border-slate-700 rounded-lg p-6">
              <h2 className="text-lg font-semibold mb-4 text-slate-100">Add Video</h2>
              <IngestionForm onSubmit={handleIngest} isLoading={isLoading} />
            </div>
          </div>

          {/* Results */}
          <div className="lg:col-span-2 space-y-6">
            {/* Ingestion status */}
            {ingestionJob && (
              <IngestionStatus
                status={
                  ingestionJob.status as unknown as
                    | 'PENDING'
                    | 'PROCESSING'
                    | 'COMPLETED'
                    | 'FAILED'
                    | 'RETRYING'
                }
                failureReason={ingestionJob.failureReason}
                retryCount={ingestionJob.retryCount}
                startedAt={ingestionJob.startedAt}
                completedAt={ingestionJob.completedAt}
              />
            )}

            {/* Metadata preview */}
            {ingestedVideo && (
              <VideoMetadataPreview
                title={ingestedVideo.title}
                description={ingestedVideo.description}
                creatorName={ingestedVideo.creatorName}
                creatorHandle={ingestedVideo.creatorHandle}
                platform={ingestedVideo.platform}
                platformVideoId={ingestedVideo.platformVideoId}
                views={ingestedVideo.views}
                likes={ingestedVideo.likes}
                comments={ingestedVideo.comments}
                engagementRate={ingestedVideo.engagementRate}
                durationSeconds={ingestedVideo.durationSeconds}
                hashtags={ingestedVideo.hashtags}
                thumbnailUrl={ingestedVideo.thumbnailUrl}
                uploadDate={ingestedVideo.uploadDate}
              />
            )}

            {/* Transcript preview */}
            {transcriptSegments.length > 0 && <TranscriptPreview segments={transcriptSegments} />}

            {/* Error message */}
            {error && (
              <div className="bg-red-900/20 border border-red-700 rounded-lg p-4">
                <p className="text-red-200 text-sm font-semibold">Error</p>
                <p className="text-red-100">{error}</p>
              </div>
            )}

            {/* Empty state */}
            {!ingestedVideo && !error && !isLoading && (
              <div className="bg-slate-800 border border-slate-700 rounded-lg p-8 text-center">
                <p className="text-slate-400">
                  Enter a video URL and click &quot;Ingest Video&quot; to get started
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
