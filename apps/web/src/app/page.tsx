import { Button } from '@rag/ui';
import Link from 'next/link';

export default function Home(): JSX.Element {
  return (
    <main className="min-h-screen bg-slate-950 px-6 py-12 text-slate-100">
      <div className="mx-auto flex max-w-5xl flex-col gap-8 rounded-3xl border border-slate-800 bg-slate-900/90 p-10 shadow-xl shadow-slate-950/20">
        <div className="space-y-4">
          <p className="text-sm uppercase tracking-[0.3em] text-sky-400">Phase 1 & 2 Foundation</p>
          <h1 className="text-4xl font-semibold">RAG Video Analyzer</h1>
          <p className="max-w-2xl leading-7 text-slate-300">
            A production-ready monorepo for AI video analysis with provider adapters for YouTube,
            Instagram, and TikTok. Features typed APIs, modular UI, shared schemas, transcript
            ingestion, and Dockerized infrastructure.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-3xl border border-slate-800 bg-slate-950/80 p-6">
            <h2 className="mb-2 text-xl font-semibold text-white">Video Ingestion</h2>
            <p className="mb-4 text-slate-400">
              Ingest and analyze videos from your favorite platforms with automatic metadata
              extraction and transcript acquisition.
            </p>
            <Link href="/ingest">
              <Button>Start Ingesting</Button>
            </Link>
          </div>

          <div className="rounded-3xl border border-slate-800 bg-slate-950/80 p-6">
            <h2 className="mb-2 text-xl font-semibold text-white">API Health</h2>
            <p className="text-slate-400">
              Reach the API health route at <code>/health</code> after starting the backend.
            </p>
          </div>
        </div>

        <div className="space-y-2 pt-4 border-t border-slate-800">
          <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wide">
            Architecture
          </h3>
          <ul className="grid gap-2 text-sm text-slate-400">
            <li className="flex items-start">
              <span className="mr-2">✓</span>
              <span>Provider adapter system (YouTube, Instagram, TikTok)</span>
            </li>
            <li className="flex items-start">
              <span className="mr-2">✓</span>
              <span>URL validation and normalization</span>
            </li>
            <li className="flex items-start">
              <span className="mr-2">✓</span>
              <span>Layered transcript acquisition pipeline</span>
            </li>
            <li className="flex items-start">
              <span className="mr-2">✓</span>
              <span>Idempotent ingestion service</span>
            </li>
            <li className="flex items-start">
              <span className="mr-2">✓</span>
              <span>Production database schema with lifecycle tracking</span>
            </li>
          </ul>
        </div>
      </div>
    </main>
  );
}
