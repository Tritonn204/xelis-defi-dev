# syntax=docker/dockerfile:1.7-labs
# ---- builder ----
FROM node:20-slim AS builder
WORKDIR /repo

ARG PNPM_IMPORT_METHOD=copy
ENV PNPM_STORE_DIR=/pnpm-store

# pnpm via Corepack
RUN corepack enable && corepack prepare pnpm@latest --activate

# Workspace roots & shared config (single layer)
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc tsconfig*.json ./

# Copy only manifests first for better cache hits
COPY packages/shared/package.json      packages/shared/
COPY packages/forge-admin/package.json packages/forge-admin/

# Install deps using a persistent pnpm store cache (CRLF-safe)
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
  /bin/sh -c 'set -eux; \
    pnpm fetch --package-import-method="$PNPM_IMPORT_METHOD"; \
    pnpm install --frozen-lockfile --package-import-method="$PNPM_IMPORT_METHOD"'

# Now copy sources
COPY packages/shared/      packages/shared/
COPY packages/forge-admin/ packages/forge-admin/

# Build & produce prod-only bundle (CRLF-safe, single layer)
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
  /bin/sh -c 'set -eux; \
    pnpm -F "@forge-backend/shared" build; \
    pnpm -F "@forge-backend/forge-admin" build; \
    mkdir -p /out; \
    pnpm -F "@forge-backend/forge-admin" deploy --prod /out --package-import-method="$PNPM_IMPORT_METHOD"'

# ---- runtime ----
FROM node:20-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    NODE_OPTIONS="--experimental-specifier-resolution=node"

# Copy pruned output only; run as non-root
COPY --from=builder --chown=node:node /out/ ./
USER node

EXPOSE 3001
# Adjust entrypoint/command to your output structure
CMD ["node", "dist/server/index.js"]
