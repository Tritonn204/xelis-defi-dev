# ---- builder ----
FROM node:20-slim AS builder
WORKDIR /repo

ARG PNPM_IMPORT_METHOD=copy
ENV PNPM_STORE_DIR=/pnpm-store

RUN corepack enable && corepack prepare pnpm@latest --activate
ENV PNPM_STORE_DIR=/pnpm-store

# Roots & manifests
COPY pnpm-workspace.yaml ./
COPY package.json pnpm-lock.yaml ./
COPY .npmrc .npmrc
COPY tsconfig*.json ./
COPY packages/shared/package.json        packages/shared/
COPY packages/forge-api/package.json     packages/forge-api/

# Use cache mount where network helps a lot
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store pnpm fetch --package-import-method=${PNPM_IMPORT_METHOD}
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store pnpm install --frozen-lockfile --package-import-method=${PNPM_IMPORT_METHOD}

# Sources
COPY packages/shared/        packages/shared/
COPY packages/forge-api/     packages/forge-api/

# Build
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store pnpm -F "@forge-backend/shared" build
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store pnpm -F "@forge-backend/forge-api" build

# Deploy
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store pnpm -F "@forge-backend/forge-api" deploy --prod /out --package-import-method=${PNPM_IMPORT_METHOD}

# ---- runtime ----
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NODE_OPTIONS="--experimental-specifier-resolution=node"

# Copy pruned app
COPY --from=builder /out/ ./

# Copy API entrypoint, normalize CRLF, make executable
COPY packages/forge-api/docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN sed -i 's/\r$//' /usr/local/bin/entrypoint.sh && chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["node", "/app/dist/server.js"]