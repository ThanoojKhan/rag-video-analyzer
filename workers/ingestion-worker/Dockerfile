FROM node:20-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS builder
# Set working directory
WORKDIR /app
RUN pnpm install turbo --global

# Install dependencies needed for node-gyp and native modules if any
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY . .
RUN turbo prune --scope=@rag/ingestion-worker --docker

FROM base AS installer
WORKDIR /app

# Install dependencies needed for node-gyp and native modules if any
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# First install dependencies (as they change less often)
COPY .gitignore .gitignore
COPY --from=builder /app/out/json/ .
COPY --from=builder /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=builder /app/out/pnpm-workspace.yaml ./pnpm-workspace.yaml
RUN pnpm install --frozen-lockfile

# Build the project and its dependencies
COPY --from=builder /app/out/full/ .
COPY turbo.json turbo.json
RUN pnpm turbo run build --filter=@rag/ingestion-worker

FROM base AS runner
WORKDIR /app

# The worker requires ffmpeg to process audio streams from Instagram/yt-dlp
# It also requires python3 to run the yt-dlp binary safely
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    && rm -rf /var/lib/apt/lists/*

# Create a non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 workeruser

COPY --from=installer /app/ .

WORKDIR /app/workers/ingestion-worker

# Setup cache directory for transformers ONNX models so they aren't downloaded to /tmp
RUN mkdir -p /app/.cache && chown -R workeruser:nodejs /app/.cache
ENV TRANSFORMERS_CACHE="/app/.cache"

# Set production environment
ENV NODE_ENV=production

USER workeruser

CMD ["node", "dist/index.js"]
