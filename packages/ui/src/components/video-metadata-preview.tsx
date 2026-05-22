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
        <div className="flex items-center space-x-2">
          <span className="text-slate-400 text-sm">by</span>
          <span className="text-slate-200 font-semibold">{creatorName || creatorHandle}</span>
          {creatorHandle && <span className="text-slate-500 text-sm">@{creatorHandle}</span>}
          {followerCount != null && (
            <span className="text-sky-400 text-xs ml-2 px-1.5 py-0.5 bg-sky-900/30 rounded">
              {formatNumber(followerCount)} followers
            </span>
          )}
        </div>
      )}

      {/* Description */}
      {description && <p className="text-slate-300 text-sm line-clamp-3">{description}</p>}

      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-slate-800 rounded p-3">
          <p className="text-slate-400 text-xs uppercase tracking-wide">Views</p>
          <p className="text-slate-100 font-semibold text-lg">{formatNumber(views)}</p>
        </div>

        <div className="bg-slate-800 rounded p-3">
          <p className="text-slate-400 text-xs uppercase tracking-wide">Likes</p>
          <p className="text-slate-100 font-semibold text-lg">{formatNumber(likes)}</p>
        </div>

        <div className="bg-slate-800 rounded p-3">
          <p className="text-slate-400 text-xs uppercase tracking-wide">Comments</p>
          <p className="text-slate-100 font-semibold text-lg">{formatNumber(comments)}</p>
        </div>

        <div className="bg-slate-800 rounded p-3">
          <p className="text-slate-400 text-xs uppercase tracking-wide">Engagement</p>
          <p className="text-slate-100 font-semibold text-lg">
            {views > 0 ? (((likes + comments) / views) * 100).toFixed(2) : '0.00'}%
          </p>
        </div>
      </div>

      {/* Duration */}
      <div className="flex justify-between items-center text-sm">
        <span className="text-slate-400">Duration</span>
        <span className="text-slate-200 font-semibold">{formatDuration(durationSeconds)}</span>
      </div>

      {/* Upload date */}
      {uploadDate && (
        <div className="flex justify-between items-center text-sm">
          <span className="text-slate-400">Uploaded</span>
          <span className="text-slate-200">{new Date(uploadDate).toLocaleDateString()}</span>
        </div>
      )}

      {/* Platform info */}
      <div className="flex justify-between items-center text-sm pt-2 border-t border-slate-700">
        <span className="text-slate-400">Platform</span>
        <span className="text-slate-200 capitalize font-semibold">{platform}</span>
      </div>

      {/* Platform video id */}
      <div className="flex justify-between items-center text-sm pt-2">
        <span className="text-slate-400">Video ID</span>
        <span className="text-slate-200 font-mono">{platformVideoId}</span>
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
