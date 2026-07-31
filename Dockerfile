# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS web-build

WORKDIR /app/web
ARG BUILD_NODE_OPTIONS=--max-old-space-size=1536
ARG NEXT_BUILD_CPUS=1
ARG PNPM_VERSION=11.7.0
ENV NEXT_TELEMETRY_DISABLED=1
ENV CI=1
ENV NODE_OPTIONS=${BUILD_NODE_OPTIONS}
ENV NEXT_BUILD_CPUS=${NEXT_BUILD_CPUS}
ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}

RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

COPY web/package.json web/pnpm-lock.yaml web/pnpm-workspace.yaml ./
RUN --mount=type=cache,target=/pnpm/store pnpm install --frozen-lockfile --store-dir=/pnpm/store

COPY VERSION /app/VERSION
COPY CHANGELOG.md /app/CHANGELOG.md
COPY web ./
RUN --mount=type=cache,target=/app/web/.next/cache pnpm run typecheck && NEXT_SKIP_BUILD_TYPECHECK=1 pnpm run build

FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV VOZEB_PRO_DATA_DIR=/app/web/.data
ENV VOZEB_PRO_INTERNAL_ORIGIN=http://127.0.0.1:3000
ENV NODE_OPTIONS=--max-old-space-size=384
ENV UV_THREADPOOL_SIZE=2

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates ffmpeg fonts-noto-cjk && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /app/web/scripts

COPY VERSION /app/VERSION
COPY CHANGELOG.md /app/CHANGELOG.md
COPY --from=web-build /app/web/public /app/web/public
COPY --from=web-build /app/web/.next/standalone /app/web
COPY --from=web-build /app/web/.next/static /app/web/.next/static
COPY web/scripts/reset-admin-password.mjs /app/web/scripts/reset-admin-password.mjs
COPY web/scripts/generation-runtime.mjs /app/web/scripts/generation-runtime.mjs
COPY web/scripts/generation-worker.mjs /app/web/scripts/generation-worker.mjs

EXPOSE 3000
CMD ["sh", "-c", "cd /app/web && PORT=3000 node server.js"]
