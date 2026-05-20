'use client';

import { useState } from 'react';
import { Button } from './button';

interface IngestionFormProps {
  onSubmit: (url: string, options: IngestionOptions) => Promise<void>;
  isLoading?: boolean;
}

export interface IngestionOptions {
  refreshMetadata?: boolean;
  skipTranscript?: boolean;
}

export function IngestionForm({ onSubmit, isLoading = false }: IngestionFormProps): JSX.Element {
  const [url, setUrl] = useState('');
  const [refreshMetadata, setRefreshMetadata] = useState(false);
  const [skipTranscript, setSkipTranscript] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);

    if (!url.trim()) {
      setError('Please enter a URL');
      return;
    }

    try {
      await onSubmit(url, {
        refreshMetadata,
        skipTranscript,
      });
      setUrl('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to ingest video');
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="url-input" className="block text-sm font-medium text-slate-200 mb-2">
          Video URL
        </label>
        <input
          id="url-input"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://youtube.com/watch?v=... or Instagram/TikTok link"
          disabled={isLoading}
          className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-500 disabled:opacity-50"
        />
      </div>

      <div className="space-y-3">
        <label className="flex items-center space-x-3">
          <input
            type="checkbox"
            checked={refreshMetadata}
            onChange={(e) => setRefreshMetadata(e.target.checked)}
            disabled={isLoading}
            className="w-4 h-4 bg-slate-900 border border-slate-700 rounded cursor-pointer"
          />
          <span className="text-sm text-slate-300">Refresh metadata if video exists</span>
        </label>

        <label className="flex items-center space-x-3">
          <input
            type="checkbox"
            checked={skipTranscript}
            onChange={(e) => setSkipTranscript(e.target.checked)}
            disabled={isLoading}
            className="w-4 h-4 bg-slate-900 border border-slate-700 rounded cursor-pointer"
          />
          <span className="text-sm text-slate-300">Skip transcript</span>
        </label>
      </div>

      {error && (
        <div className="p-3 bg-red-900 border border-red-700 rounded-lg text-red-100 text-sm">
          {error}
        </div>
      )}

      <Button type="submit" disabled={isLoading} className="w-full">
        {isLoading ? 'Ingesting...' : 'Ingest Video'}
      </Button>
    </form>
  );
}
