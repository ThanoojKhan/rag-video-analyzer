import React from 'react';
import type { ChatMessage as ChatMessageType } from '@rag/shared';
import { CitationBadge } from './citation-badge';

interface ChatMessageProps {
  message: ChatMessageType;
}

export const ChatMessage = React.memo(function ChatMessage({
  message,
}: ChatMessageProps): JSX.Element {
  const isUser = message.role === 'user';

  // Basic regex to find [REF-N] citations and replace them with badges
  const renderContentWithCitations = (): React.ReactNode => {
    if (!message.citations || message.citations.length === 0) {
      return <span className="whitespace-pre-wrap">{message.content}</span>;
    }

    const parts = message.content.split(/(\[REF-\d+\])/g);

    return parts.map((part, index) => {
      const match = part.match(/\[REF-(\d+)\]/);
      if (match && match[1]) {
        const refIndex = parseInt(match[1], 10);
        const citation = message.citations?.find((c) => c.refIndex === refIndex);
        if (citation) {
          return <CitationBadge key={`${index}-${refIndex}`} citation={citation} />;
        }
      }
      return (
        <span key={index} className="whitespace-pre-wrap">
          {part}
        </span>
      );
    });
  };

  const copyToClipboard = (): void => {
    navigator.clipboard.writeText(message.content).catch(console.error);
  };

  return (
    <div className={`flex w-full ${isUser ? 'justify-end' : 'justify-start'} mb-6 group`}>
      <div
        className={`relative max-w-[85%] rounded-2xl px-5 py-4 ${
          isUser
            ? 'bg-sky-600 text-white rounded-br-sm shadow-md'
            : 'bg-slate-800 text-slate-200 border border-slate-700 rounded-bl-sm shadow-md shadow-slate-900/50'
        }`}
      >
        {/* Copy Button (shows on hover) */}
        {!(!isUser && message.content === '') && (
          <button
            onClick={copyToClipboard}
            className={`absolute top-2 ${isUser ? '-left-10 text-slate-400 hover:text-white' : '-right-10 text-slate-500 hover:text-white'} opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md hover:bg-slate-800/50`}
            title="Copy message"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
              />
            </svg>
          </button>
        )}

        <div className="text-[15px] leading-relaxed">
          {!isUser && message.content === '' ? (
            <div className="flex items-center gap-1.5 h-6">
              <div
                className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse"
                style={{ animationDelay: '0ms', animationDuration: '1s' }}
              />
              <div
                className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse"
                style={{ animationDelay: '200ms', animationDuration: '1s' }}
              />
              <div
                className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse"
                style={{ animationDelay: '400ms', animationDuration: '1s' }}
              />
            </div>
          ) : (
            renderContentWithCitations()
          )}
        </div>

        {/* Render block citations if they exist but aren't inline (fallback) */}
        {!isUser && message.citations && message.citations.length > 0 && (
          <div className="mt-4 pt-3 border-t border-slate-700/50 flex flex-wrap gap-2">
            <span className="text-xs text-slate-400 w-full mb-1">Sources:</span>
            {message.citations.map((cit) => (
              <div
                key={cit.refIndex}
                className="flex items-center gap-2 text-xs bg-slate-900/50 px-2 py-1.5 rounded border border-slate-700/50"
              >
                <span className="text-sky-400 font-medium">[{cit.refIndex}]</span>
                <span className="text-slate-300 truncate max-w-[150px]" title={cit.videoTitle}>
                  {cit.videoTitle}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});
