import { Button } from '@rag/ui';

export default function Home(): JSX.Element {
  return (
    <main className="min-h-screen bg-slate-950 px-6 py-12 text-slate-100">
      <div className="mx-auto flex max-w-5xl flex-col gap-8 rounded-3xl border border-slate-800 bg-slate-900/90 p-10 shadow-xl shadow-slate-950/20">
        <div className="space-y-4">
          <p className="text-sm uppercase tracking-[0.3em] text-sky-400">Phase 1 foundation</p>
          <h1 className="text-4xl font-semibold">RAG Video Analyzer</h1>
          <p className="max-w-2xl leading-7 text-slate-300">
            A production-ready monorepo foundation for AI video analysis, featuring a typed API,
            reusable UI package, shared schemas, and Dockerized infrastructure for Postgres and
            Redis.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-3xl border border-slate-800 bg-slate-950/80 p-6">
            <h2 className="mb-2 text-xl font-semibold text-white">Health endpoint</h2>
            <p className="text-slate-400">
              Reach the API health route at <code>/health</code> after starting the backend.
            </p>
          </div>

          <div className="rounded-3xl border border-slate-800 bg-slate-950/80 p-6">
            <h2 className="mb-2 text-xl font-semibold text-white">Modular UI</h2>
            <p className="text-slate-400">
              The UI package is built as a reusable component library prepared for future design
              system expansion.
            </p>
            <Button>Learn more</Button>
          </div>
        </div>
      </div>
    </main>
  );
}
