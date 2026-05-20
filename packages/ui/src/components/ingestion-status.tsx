'use client';

import { useEffect, useState } from 'react';

type IngestionStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'RETRYING';

interface IngestionStatusProps {
  status: IngestionStatus;
  failureReason?: string | null;
  retryCount?: number;
  startedAt?: string | null;
  completedAt?: string | null;
}

const statusConfig: Record<IngestionStatus, { color: string; icon: string; label: string }> = {
  PENDING: {
    color: 'bg-slate-700',
    icon: '⏳',
    label: 'Pending',
  },
  PROCESSING: {
    color: 'bg-blue-900',
    icon: '⚙️',
    label: 'Processing',
  },
  COMPLETED: {
    color: 'bg-green-900',
    icon: '✓',
    label: 'Completed',
  },
  FAILED: {
    color: 'bg-red-900',
    icon: '✕',
    label: 'Failed',
  },
  RETRYING: {
    color: 'bg-yellow-900',
    icon: '↻',
    label: 'Retrying',
  },
};

export function IngestionStatus({
  status,
  failureReason,
  retryCount = 0,
  startedAt,
  completedAt,
}: IngestionStatusProps): JSX.Element {
  const [duration, setDuration] = useState<string | null>(null);
  const config = statusConfig[status];

  useEffect(() => {
    if (!startedAt) return;

    const interval = setInterval(() => {
      const start = new Date(startedAt).getTime();
      const end = completedAt ? new Date(completedAt).getTime() : Date.now();
      const diff = end - start;
      const seconds = Math.floor(diff / 1000);
      const minutes = Math.floor(seconds / 60);

      if (minutes > 0) {
        setDuration(`${minutes}m ${seconds % 60}s`);
      } else {
        setDuration(`${seconds}s`);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [startedAt, completedAt]);

  return (
    <div className={`${config.color} border border-slate-600 rounded-lg p-4 space-y-2`}>
      <div className="flex items-center space-x-2">
        <span className="text-2xl">{config.icon}</span>
        <h3 className="font-semibold text-slate-100">{config.label}</h3>
      </div>

      {duration && <p className="text-sm text-slate-300">Duration: {duration}</p>}

      {retryCount > 0 && <p className="text-sm text-slate-300">Retries: {retryCount}</p>}

      {failureReason && (
        <p className="text-sm text-red-200">
          <span className="font-semibold">Error: </span>
          {failureReason}
        </p>
      )}
    </div>
  );
}
