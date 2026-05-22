import React from 'react';
import type { ChatCitation } from '@rag/shared';

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

interface CitationBadgeProps {
  citation: ChatCitation;
}

export function CitationBadge({ citation }: CitationBadgeProps): JSX.Element {
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 mx-1 rounded-md bg-sky-900/40 border border-sky-800/60 text-sky-200 text-xs font-medium cursor-help hover:bg-sky-800/60 transition-colors"
      title={`${citation.videoTitle} (${formatTime(citation.startSeconds)} - ${formatTime(citation.endSeconds)})`}
    >
      <svg className="w-3 h-3 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"
        />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
      <span>
        [{citation.refIndex}] {formatTime(citation.startSeconds)}
      </span>
    </span>
  );
}
