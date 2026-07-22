# Syncratch Railway verification image: editor static + /signal WebSocket.
# Build context = repository root. Submodule contents may be absent in the
# uploaded archive; scripts/ensure-vendor-scratch-editor.sh clones the pin.
FROM node:24-bookworm-slim AS build

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tsconfig.base.json ./
COPY scripts ./scripts
COPY packages ./packages
COPY apps ./apps
COPY vendor ./vendor

# Public browser OAuth client values (optional). Not server secrets; baked into SPA.
# check=skip: SecretsUsedInArgOrEnv
ARG VITE_GOOGLE_CLIENT_ID=
# check=skip: SecretsUsedInArgOrEnv
ARG VITE_GOOGLE_API_KEY=
# check=skip: SecretsUsedInArgOrEnv
ARG VITE_GOOGLE_APP_ID=
ARG SCRATCH_EDITOR_SHA=7c172e469eb3c21c1e6326ea6cccea60bc14e3a8

ENV VITE_COLLAB_SIGNALING_URL=same-origin
ENV BLOCKSYNC_BASE_PATH=/
# check=skip: SecretsUsedInArgOrEnv
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID
# check=skip: SecretsUsedInArgOrEnv
ENV VITE_GOOGLE_API_KEY=$VITE_GOOGLE_API_KEY
# check=skip: SecretsUsedInArgOrEnv
ENV VITE_GOOGLE_APP_ID=$VITE_GOOGLE_APP_ID
ENV SCRATCH_EDITOR_SHA=$SCRATCH_EDITOR_SHA

RUN chmod +x scripts/ensure-vendor-scratch-editor.sh \
  && scripts/ensure-vendor-scratch-editor.sh

RUN pnpm install --frozen-lockfile
RUN pnpm gate0:build-vendor-vm
RUN pnpm gate0:build-vendor-gui-spike
RUN pnpm --filter @blocksync/editor-web build

FROM build AS export

# Produce a self-contained deploy directory (workspace deps + tsx).
RUN pnpm --filter @blocksync/collab-host deploy --prod --legacy /out/app \
  && mkdir -p /out/app/public \
  && cp -a /app/apps/editor-web/dist/. /out/app/public/

FROM node:24-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080
ENV HOST=0.0.0.0
ENV STATIC_ROOT=/app/public

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

COPY --from=export /out/app /app

EXPOSE 8080

CMD ["pnpm", "start"]
