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

  return (
    <div className={`flex w-full ${isUser ? 'justify-end' : 'justify-start'} mb-6`}>
      <div
        className={`max-w-[85%] rounded-2xl px-5 py-4 ${
          isUser
            ? 'bg-sky-600 text-white rounded-br-sm shadow-md'
            : 'bg-slate-800 text-slate-200 border border-slate-700 rounded-bl-sm shadow-md shadow-slate-900/50'
        }`}
      >
        <div className="text-[15px] leading-relaxed">{renderContentWithCitations()}</div>

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
