'use client';

interface VideoMetadataPreviewProps {
  title: string;
  description?: string | null;
  creatorName?: string | null;
  creatorHandle?: string | null;
  platform: string;
  platformVideoId: string;
  views: number;
  likes: number;
  comments: number;
  engagementRate: number;
  followerCount?: number | null;
  durationSeconds: number;
  hashtags?: string[];
  thumbnailUrl?: string | null;
  uploadDate?: string | null;
}

function formatNumber(num: number): string {
  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(1)}M`;
  }
  if (num >= 1_000) {
    return `${(num / 1_000).toFixed(1)}K`;
  }
  return num.toString();
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`;
  }
  return `${minutes}m ${secs}s`;
}

export function VideoMetadataPreview({
  title,
  description,
  creatorName,
  creatorHandle,
  platform,
  platformVideoId,
  views,
  likes,
  comments,

  followerCount,
  durationSeconds,
  hashtags = [],
  thumbnailUrl,
  uploadDate,
}: VideoMetadataPreviewProps): JSX.Element {
  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 space-y-4">
      {/* Thumbnail */}
      {thumbnailUrl && (
        <img
          src={thumbnailUrl}
          alt={title}
          className="w-full h-auto rounded-lg object-cover aspect-video"
        />
      )}

      {/* Title */}
      <div>
        <h2 className="text-xl font-bold text-slate-100 line-clamp-2">{title}</h2>
      </div>

      {/* Creator info */}
      {(creatorName || creatorHandle) && (
        <div className="flex items-center flex-wrap gap-2 text-sm mt-1 mb-2">
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400">by</span>
            <span className="text-slate-200 font-semibold">{creatorName || creatorHandle}</span>
            {creatorHandle && creatorHandle !== creatorName && (
              <span className="text-slate-500 bg-slate-800/50 px-1.5 py-0.5 rounded-md text-xs font-mono">
                {creatorHandle.startsWith('@') ? creatorHandle : `@${creatorHandle}`}
              </span>
            )}
          </div>
          {followerCount != null && (
            <>
              <span className="text-slate-600">•</span>
              <span className="text-sky-400 text-xs px-2 py-0.5 bg-sky-900/30 border border-sky-800/50 rounded-full font-medium">
                {formatNumber(followerCount)} followers
              </span>
            </>
          )}
        </div>
      )}

      {/* Stats Row */}
      <div className="flex flex-wrap items-center gap-6 py-3 border-y border-slate-800/60 bg-slate-900/30 rounded-lg px-4 -mx-2 my-3 justify-between md:justify-start md:gap-8">
        <div className="flex items-center gap-2 text-slate-300" title="Views">
          <svg
            className="w-4 h-4 text-slate-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
            />
          </svg>
          <span className="font-medium text-sm tracking-wide">{formatNumber(views)}</span>
        </div>
        <div className="flex items-center gap-2 text-slate-300" title="Likes">
          <svg
            className="w-4 h-4 text-slate-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
            />
          </svg>
          <span className="font-medium text-sm tracking-wide">{formatNumber(likes)}</span>
        </div>
        <div className="flex items-center gap-2 text-slate-300" title="Comments">
          <svg
            className="w-4 h-4 text-slate-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
            />
          </svg>
          <span className="font-medium text-sm tracking-wide">{formatNumber(comments)}</span>
        </div>
        <div className="flex items-center gap-2 text-slate-300" title="Engagement Rate">
          <svg
            className="w-4 h-4 text-sky-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
            />
          </svg>
          <span className="font-medium text-sm text-sky-400">
            {views > 0 ? (((likes + comments) / views) * 100).toFixed(2) : '0.00'}%
          </span>
        </div>
      </div>

      {/* Description */}
      {description && <p className="text-slate-300 text-sm line-clamp-3">{description}</p>}

      {/* Details Grid */}
      <div className="grid grid-cols-2 gap-y-4 gap-x-6 pt-5 border-t border-slate-700/60 mt-4 text-sm">
        <div>
          <p className="text-slate-500 text-[11px] font-semibold uppercase tracking-wider mb-1">
            Duration
          </p>
          <p className="text-slate-200 font-medium">{formatDuration(durationSeconds)}</p>
        </div>

        {uploadDate && (
          <div>
            <p className="text-slate-500 text-[11px] font-semibold uppercase tracking-wider mb-1">
              Uploaded
            </p>
            <p className="text-slate-200 font-medium">
              {new Date(uploadDate).toLocaleDateString()}
            </p>
          </div>
        )}

        <div>
          <p className="text-slate-500 text-[11px] font-semibold uppercase tracking-wider mb-1">
            Platform
          </p>
          <p className="text-slate-200 font-medium capitalize">{platform}</p>
        </div>

        <div>
          <p className="text-slate-500 text-[11px] font-semibold uppercase tracking-wider mb-1">
            Video ID
          </p>
          <p className="text-slate-200 font-medium font-mono text-xs">{platformVideoId}</p>
        </div>
      </div>

      {/* Hashtags */}
      {hashtags.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-2">
          {hashtags.slice(0, 5).map((tag) => (
            <span key={tag} className="bg-sky-900 text-sky-200 text-xs px-2 py-1 rounded">
              #{tag}
            </span>
          ))}
          {hashtags.length > 5 && (
            <span className="text-slate-400 text-xs px-2 py-1">+{hashtags.length - 5} more</span>
          )}
        </div>
      )}
    </div>
  );
}
