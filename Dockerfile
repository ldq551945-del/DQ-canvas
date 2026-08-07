# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e

FROM node:22-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436 AS web-build

WORKDIR /app/web
ARG BUILD_NODE_OPTIONS=--max-old-space-size=1536
ARG NEXT_BUILD_CPUS=1
ARG NEXT_PUBLIC_TLDRAW_LICENSE_KEY
ARG PNPM_VERSION=10.34.5
ENV NEXT_TELEMETRY_DISABLED=1
ENV CI=1
ENV NODE_OPTIONS=${BUILD_NODE_OPTIONS}
ENV NEXT_BUILD_CPUS=${NEXT_BUILD_CPUS}
ENV NEXT_PUBLIC_TLDRAW_LICENSE_KEY=${NEXT_PUBLIC_TLDRAW_LICENSE_KEY}
ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}

RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

COPY web/package.json web/pnpm-lock.yaml web/pnpm-workspace.yaml ./
COPY web/patches ./patches
RUN --mount=type=cache,target=/pnpm/store pnpm install --frozen-lockfile --store-dir=/pnpm/store

COPY VERSION /app/VERSION
COPY CHANGELOG.md /app/CHANGELOG.md
COPY web ./
RUN --mount=type=cache,target=/app/web/.next/cache pnpm run typecheck && NEXT_SKIP_BUILD_TYPECHECK=1 pnpm run build
RUN set -eux; \
    mkdir -p /app/sharp-runtime/node_modules/.pnpm; \
    find node_modules/.pnpm -mindepth 1 -maxdepth 1 -type d -name '@img+sharp-*' -exec cp -a {} /app/sharp-runtime/node_modules/.pnpm/ \;; \
    test -n "$(find /app/sharp-runtime/node_modules/.pnpm -mindepth 1 -maxdepth 1 -type d -name '@img+sharp-linux-*' -print -quit)"; \
    test -n "$(find /app/sharp-runtime/node_modules/.pnpm -mindepth 1 -maxdepth 1 -type d -name '@img+sharp-libvips-linux-*' -print -quit)"

FROM node:22-bookworm-slim@sha256:d649c27dae7ba0137b3cef5dd75baa422c08dc3d9e3fc0c23dfb172dc3cc6436

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV DQ_DATA_DIR=/app/web/.data
ENV DQ_INTERNAL_ORIGIN=http://127.0.0.1:3000
ENV NODE_OPTIONS=--max-old-space-size=384
ENV UV_THREADPOOL_SIZE=2

RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl ffmpeg fonts-noto-cjk gnupg; \
    install -d -m 0755 /usr/share/postgresql-common/pgdg; \
    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.gpg; \
    echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.gpg] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list; \
    apt-get update; \
    apt-get install -y --no-install-recommends postgresql-client-16; \
    apt-get purge -y --auto-remove curl gnupg; \
    rm -rf /var/lib/apt/lists/*
RUN mkdir -p /app/web/scripts

COPY VERSION /app/VERSION
COPY CHANGELOG.md /app/CHANGELOG.md
COPY --from=web-build /app/web/public /app/web/public
COPY --from=web-build /app/web/.next/standalone /app/web
COPY --from=web-build /app/web/.next/static /app/web/.next/static
COPY --from=web-build /app/sharp-runtime/node_modules/.pnpm /app/web/node_modules/.pnpm
COPY web/scripts/reset-admin-password.mjs /app/web/scripts/reset-admin-password.mjs
COPY web/scripts/http-observability.mjs /app/web/scripts/http-observability.mjs
COPY web/scripts/generation-runtime.mjs /app/web/scripts/generation-runtime.mjs
COPY web/scripts/generation-worker.mjs /app/web/scripts/generation-worker.mjs
COPY web/scripts/disaster-recovery-core.mjs /app/web/scripts/disaster-recovery-core.mjs
COPY web/scripts/disaster-object-storage.mjs /app/web/scripts/disaster-object-storage.mjs
COPY web/scripts/disaster-backup.mjs /app/web/scripts/disaster-backup.mjs
COPY web/scripts/disaster-restore.mjs /app/web/scripts/disaster-restore.mjs

RUN cd /app/web && node -e "require('sharp')"
RUN mkdir -p /app/web/.data && chown -R node:node /app/web
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack

EXPOSE 3000
WORKDIR /app/web
USER node
CMD ["node", "--import", "file:///app/web/scripts/http-observability.mjs", "server.js"]
