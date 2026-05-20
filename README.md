# RAG Video Analyzer

Production-grade Phase 1 foundation for an AI video analysis platform.

This repository intentionally stops at infrastructure. It does not implement RAG, embeddings, transcript ingestion, chat, vector search, or video analysis logic yet. Phase 1 is about creating a boring, reliable base that can absorb those features later without turning into a knot.

## Architecture Overview

- `apps/web` - Next.js 15 App Router frontend. It runs locally and consumes shared UI packages, but does not own backend or AI concerns.
- `apps/api` - Fastify API with structured logging, fail-fast environment validation, centralized error handling, health checks, Prisma connectivity, and graceful shutdown.
- `workers/ingestion-worker` - Minimal worker bootstrap prepared for future queue-backed ingestion. It currently validates env, logs structurally, and shuts down cleanly.
- `packages/shared` - Shared Zod schemas and inferred TypeScript contracts. This package is for stable cross-boundary types, not application behavior.
- `packages/db` - Prisma client boundary and database preparation utilities. Prisma is centralized here to avoid leaking database setup across apps.
- `packages/ui` - Small reusable UI package for frontend components.
- `packages/ai` - Reserved package boundary for future AI adapters. It is intentionally empty in Phase 1.
- `infra/docker` - Local infrastructure only: PostgreSQL with pgvector and Redis.

## Monorepo Model

The repo uses pnpm workspaces through `pnpm-workspace.yaml` and Turborepo for task orchestration. The root `package.json` does not duplicate workspace declarations, which keeps pnpm as the single source of truth.

Package boundaries are deliberately simple:

- Applications may depend on packages.
- Packages should not depend on applications.
- Shared packages expose stable entrypoints through `exports`.
- TypeScript path aliases point to `src` for local development, not `dist`, so typechecking does not depend on stale build artifacts.
- Runtime imports still resolve package `exports`, so production behavior matches the built package surface.

## Why Fastify

Fastify gives the API a small operational core: structured Pino logging, lifecycle hooks, plugin boundaries, strong async behavior, and good performance without a heavy framework. That fits this phase better than adding broad application architecture before there is product behavior to organize.

## Why PostgreSQL And pgvector

PostgreSQL is the system of record. It gives the product relational integrity, migrations, JSON support, and operational familiarity. pgvector is included now because future semantic search will need vector storage close to metadata and ingestion state. The extension is prepared, but no vector search or embeddings are implemented in Phase 1.

## Why Redis

Redis is present as infrastructure preparation for queues, rate limits, short-lived coordination, and future worker workflows. The Compose service enables append-only persistence so local development behaves more like a real service. No queue implementation is included yet.

## Why Workers

Video ingestion and analysis will become long-running, retryable, and eventually queue-driven. Keeping a worker workspace from the beginning prevents future background processing from being jammed into request handlers. The current worker is only a lifecycle shell.

## Why Docker Only For Infra

The frontend, API, and worker run directly on the host for fast local feedback. Docker is used for stateful dependencies that are expensive or inconsistent to install locally: PostgreSQL with pgvector and Redis. This keeps development simple while preserving realistic infrastructure.

## Local Setup

Install dependencies:

```bash
pnpm install
```

Start infrastructure:

```bash
pnpm docker:up
```

Apply database migrations:

```bash
pnpm --filter @rag/db migrate:deploy
```

Run the API:

```bash
pnpm dev:api
```

Run the web app:

```bash
pnpm dev:web
```

Run the worker shell:

```bash
pnpm dev:worker
```

Default local endpoints:

- API: `http://127.0.0.1:4000`
- Health: `http://127.0.0.1:4000/health`
- Web: `http://127.0.0.1:3000`
- Postgres: `127.0.0.1:15432`
- Redis: `127.0.0.1:16379`

> Use `127.0.0.1` on Windows to avoid potential `localhost`/IPv6 hostname resolution issues when the frontend calls the backend.

## Commands

- `pnpm dev` - Run persistent development tasks through Turbo.
- `pnpm dev:api` - Start only the Fastify API.
- `pnpm dev:web` - Start only the Next.js app.
- `pnpm dev:worker` - Start only the ingestion worker shell.
- `pnpm build` - Build all workspaces.
- `pnpm lint` - Lint all workspaces.
- `pnpm test` - Run lightweight Phase 1 tests.
- `pnpm typecheck` - Typecheck all workspaces.
- `pnpm format` - Format source and config files.
- `pnpm docker:up` - Start local Postgres and Redis.
- `pnpm docker:down` - Stop local Postgres and Redis.

## Environment

Environment variables are validated with Zod at process startup. Invalid values fail fast before the server or worker begins doing work.

The API expects:

- `HOST` (recommended: `127.0.0.1` for local development)
- `PORT`
- `PORT_FALLBACK` (default: `false`)
- `NODE_ENV`
- `LOG_LEVEL`
- `DATABASE_URL`
- `REDIS_URL`
- `CORS_ORIGIN` required in production
- `NEXT_PUBLIC_API_BASE_URL` optional

The worker expects:

- `NODE_ENV`
- `LOG_LEVEL`
- `DATABASE_URL`
- `REDIS_URL`

## Startup Lifecycle

The API starts in a strict order:

1. Load and validate environment.
2. Build the Fastify app and register plugins/routes.
3. Connect Prisma and prepare pgvector.
4. Bind the HTTP listener.
5. Log process metadata and selected port.

If the configured port is occupied in development and `PORT_FALLBACK=true`, the API tries the next available ports and logs the selected fallback. If `PORT_FALLBACK` is unset or `false`, the API fails loudly instead of silently moving to a new port. In production, port fallback should be disabled so deployment configuration stays explicit.

> On Windows, `localhost` may resolve through IPv6 to another service such as Docker. Use `127.0.0.1` if the API appears to be unavailable on `localhost:4000`.

Shutdown is idempotent. `SIGINT`, `SIGTERM`, unhandled rejections, and uncaught exceptions all flow through app close, which disconnects Prisma before the process exits.

## Database And Migrations

Prisma lives behind `packages/db`. The initial migration creates the pgvector extension and the current `Video` table. Future schema changes should be represented as Prisma migrations, not ad hoc `db push` changes.

The Prisma client is singleton-safe for local hot reload and worker/API reuse. Application code should import database access from `@rag/db` rather than creating additional Prisma clients.

### Windows Prisma Notes

On Windows, Prisma's query engine DLL can be locked by a running Node process. If `prisma generate` fails with an `EPERM` rename error:

1. Stop `pnpm dev:api`, `pnpm dev:worker`, and any Node process importing `@rag/db`.
2. Run `pnpm --filter @rag/db prisma:generate`.
3. Restart the API or worker.

This is a local development file-locking issue, not a schema problem. The repo keeps Prisma behind `@rag/db` to reduce the number of processes that can load the generated client.

## Testing

Vitest is configured for lightweight Phase 1 coverage:

- shared env validation
- API app construction and `/health`
- production CORS guard behavior
- worker lifecycle bootstrap
- Prisma package boundary and opt-in DB smoke structure

The DB smoke test is intentionally opt-in via `RUN_DB_SMOKE=true` so normal CI does not require a live database. Full integration tests belong in Phase 2 once real ingestion and retrieval behavior exists.

## CI

GitHub Actions runs:

1. Install
2. Lint
3. Typecheck
4. Test
5. Build

This is intentionally modest. Phase 1 should prove that the workspace compiles and package boundaries remain healthy before adding heavier checks.

## Scaling Preparation

This foundation prepares for growth without pretending the product is already large:

- API request/response work is separate from worker lifecycle work.
- Database ownership is centralized.
- Shared schemas are reusable without coupling packages to application internals.
- Docker Compose covers local stateful infrastructure only.
- Turbo caches build outputs while treating dev tasks as persistent.
- pgvector is available before semantic search arrives, reducing future infrastructure churn.

## Package Responsibilities

- `apps/api` owns HTTP lifecycle, request logging, error handling, and route registration.
- `apps/web` owns user-facing rendering only.
- `workers/ingestion-worker` owns future background lifecycle, not request/response behavior.
- `packages/db` owns Prisma and database preparation.
- `packages/shared` owns stable schemas and cross-package types.
- `packages/ui` owns reusable presentation primitives.
- `packages/ai` is reserved for future provider/adaptor code and stays empty until real requirements exist.

## Future Ingestion Pipeline

The expected Phase 2 ingestion path is: API accepts metadata, stores initial state, enqueues work, worker performs long-running extraction/transcription steps, worker persists progress, API exposes status. Keeping this flow out of Phase 1 avoids fake queue abstractions while preserving a clear home for them.

## Future RAG Orchestration

RAG orchestration should live behind package boundaries once real retrieval requirements are known. A likely split is provider adapters in `packages/ai`, persistence in `packages/db`, and HTTP contracts in `apps/api`. The repo does not choose LangChain, LangGraph, or a custom orchestrator yet because that decision should follow the actual retrieval workflow.

## Scaling Bottlenecks

- PostgreSQL plus pgvector is excellent for early product velocity, but high-volume vector workloads may eventually need partitioning, read replicas, dedicated indexes, or a specialized vector service.
- Redis append-only persistence is useful locally, but production queues need explicit retry, dead-letter, and idempotency semantics.
- Fastify is not the bottleneck yet; slow work must move to workers before upload/transcription workloads arrive.
- Shared Zod schemas are convenient, but they should not become a dumping ground for application internals.

## Future RAG Roadmap

Phase 2 can add product behavior in thin slices:

1. Upload or register video metadata.
2. Queue ingestion jobs through Redis-backed infrastructure.
3. Store transcript and processing state.
4. Add embedding generation behind `packages/ai`.
5. Persist vectors in PostgreSQL through pgvector.
6. Add retrieval APIs.
7. Add frontend workflows once backend contracts are real.

Each step should ship with migrations, typed contracts, tests around boundary behavior, and operational logs.

## Tradeoffs

- Fastify is lower ceremony than a full application framework, but it asks us to be disciplined about plugin boundaries and startup code.
- pgvector in PostgreSQL was chosen over Pinecone or Qdrant for this assignment because it keeps local development self-contained, aligns vectors with relational metadata, avoids external managed-service setup, and is enough for the first retrieval iterations. It is not a permanent bet against dedicated vector infrastructure.
- Dockerizing only infra keeps local iteration fast, but production deployment will still need separate container images later.
- The AI package exists now as a boundary, but stays empty to avoid locking in fake abstractions before the first real AI use case.

## Local Troubleshooting

- Port occupied: the API logs the occupied port and a hint. Stop the process using the port or set `PORT` to a free value. In development, `PORT_FALLBACK=true` allows explicit fallback, but otherwise the API fails fast. Make sure `NEXT_PUBLIC_API_BASE_URL` in the web app matches the backend host and port, and prefer `127.0.0.1` on Windows to avoid `localhost`/IPv6 ambiguity.
- Postgres unavailable: run `pnpm docker:up` and verify Docker reports `db` as healthy.
- Redis unavailable: run `pnpm docker:up` and verify Docker reports `redis` as healthy.
- Prisma `DATABASE_URL` missing: use the package scripts such as `pnpm --filter @rag/db migrate:status`; they load the root `.env`.
- Prisma engine locked on Windows: stop running Node dev processes before regenerating Prisma.
- Production CORS failure: set `CORS_ORIGIN` explicitly. Wildcard CORS is intentionally development-only.
