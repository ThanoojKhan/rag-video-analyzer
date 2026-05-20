'use client';

import { useState } from 'react';

interface TranscriptSegment {
  sequenceIndex: number;
  startSeconds: number;
  endSeconds: number;
  text: string;
  sourceType: 'NATIVE' | 'EXTRACTED' | 'GENERATED';
}

interface TranscriptPreviewProps {
  segments: TranscriptSegment[];
  maxSegments?: number;
}

function formatTimestamp(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

function getSourceBadgeColor(source: string): string {
  switch (source) {
    case 'NATIVE':
      return 'bg-green-900 text-green-200';
    case 'EXTRACTED':
      return 'bg-blue-900 text-blue-200';
    case 'GENERATED':
      return 'bg-purple-900 text-purple-200';
    default:
      return 'bg-slate-700 text-slate-200';
  }
}

export function TranscriptPreview({
  segments,
  maxSegments = 5,
}: TranscriptPreviewProps): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const displaySegments = expanded ? segments : segments.slice(0, maxSegments);
  const hasMore = segments.length > maxSegments && !expanded;

  if (segments.length === 0) {
    return (
      <div className="bg-slate-900 border border-slate-700 rounded-lg p-6 text-center">
        <p className="text-slate-400">No transcript available</p>
      </div>
    );
  }

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg space-y-0 overflow-hidden">
      {/* Header */}
      <div className="bg-slate-800 px-6 py-4 border-b border-slate-700">
        <h3 className="font-semibold text-slate-100">Transcript ({segments.length} segments)</h3>
      </div>

      {/* Segments */}
      <div className="divide-y divide-slate-700">
        {displaySegments.map((segment, idx) => (
          <div
            key={`${segment.sequenceIndex}-${idx}`}
            className="p-4 hover:bg-slate-800/50 transition-colors"
          >
            {/* Time and source */}
            <div className="flex items-center justify-between mb-2">
              <span className="text-sky-400 font-mono text-sm font-semibold">
                {formatTimestamp(segment.startSeconds)} - {formatTimestamp(segment.endSeconds)}
              </span>
              <span
                className={`text-xs px-2 py-1 rounded ${getSourceBadgeColor(segment.sourceType)}`}
              >
                {segment.sourceType}
              </span>
            </div>

            {/* Text */}
            <p className="text-slate-200 text-sm leading-relaxed">{segment.text}</p>
          </div>
        ))}
      </div>

      {/* Load more button */}
      {hasMore && (
        <div className="px-6 py-4 border-t border-slate-700 text-center">
          <button
            onClick={() => setExpanded(true)}
            className="text-sky-400 hover:text-sky-300 text-sm font-semibold transition-colors"
          >
            Show all {segments.length} segments
          </button>
        </div>
      )}

      {/* Show less button */}
      {expanded && segments.length > maxSegments && (
        <div className="px-6 py-4 border-t border-slate-700 text-center">
          <button
            onClick={() => setExpanded(false)}
            className="text-sky-400 hover:text-sky-300 text-sm font-semibold transition-colors"
          >
            Show less
          </button>
        </div>
      )}
    </div>
  );
}
