# ---- builder ----
FROM node:20-slim AS builder
WORKDIR /repo

ARG PNPM_IMPORT_METHOD=copy
ENV PNPM_STORE_DIR=/pnpm-store

# Use pnpm via Corepack
RUN corepack enable && corepack prepare pnpm@latest --activate

# Use a persistent store for pnpm (only for the heavy steps)
ENV PNPM_STORE_DIR=/pnpm-store

# Workspace roots
COPY pnpm-workspace.yaml ./
COPY package.json pnpm-lock.yaml ./
COPY .npmrc ./.npmrc
COPY tsconfig*.json ./

# Bring in only the package manifests first (best cache hits)
COPY packages/shared/package.json        packages/shared/
COPY packages/forge-admin/package.json   packages/forge-admin/
COPY packages/forge-indexer/package.json packages/forge-indexer/

# Warm the store (cached)
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store pnpm fetch --package-import-method=${PNPM_IMPORT_METHOD}

# Install once (dev+prod) using the warmed store (cached)
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store pnpm install --frozen-lockfile --package-import-method=${PNPM_IMPORT_METHOD}

# Now copy sources
COPY packages/shared/        packages/shared/
COPY packages/forge-indexer/ packages/forge-indexer/

# Build shared first, then admin, then indexer (cached)
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    pnpm -F "@forge-backend/shared" build && \
    pnpm install && \
    pnpm -F "@forge-backend/forge-indexer" build

# Prepare output dir
RUN mkdir -p /out

# Produce a prod-only bundle of the indexer into /out
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store pnpm -F "@forge-backend/forge-indexer" deploy --prod /out --package-import-method=${PNPM_IMPORT_METHOD}

# ---- runtime ----
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# tolerate extension-less ESM imports from injected workspace builds
ENV NODE_OPTIONS="--experimental-specifier-resolution=node"

# Copy pruned app (code + prod deps)
COPY --from=builder /out/ ./

# Copy the entrypoint that maps *_FILE envs → real env vars, then exec node
COPY packages/forge-indexer/docker/entrypoint.sh /usr/local/bin/entrypoint.sh
# Normalize CRLF just in case the file was edited on Windows
RUN sed -i 's/\r$//' /usr/local/bin/entrypoint.sh && chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "/app/dist/index.js"]