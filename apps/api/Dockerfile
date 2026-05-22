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
RUN turbo prune --scope=apps/api --docker

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
RUN pnpm turbo run build --filter=apps/api

FROM base AS runner
WORKDIR /app

# Create a non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 apiuser

COPY --from=installer /app/ .

WORKDIR /app/apps/api

# Set production environment
ENV NODE_ENV=production
ENV PORT=4000

USER apiuser

EXPOSE 4000

CMD ["node", "dist/server.js"]
