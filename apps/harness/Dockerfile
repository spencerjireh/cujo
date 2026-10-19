# Build context is the repo root (see .dockerignore). Builds the harness
# service (decision 123). Unlike the other services this image ships
# node_modules: the pi SDK carries a wasm module and a runtime loader that do
# not survive bundling, so only the workspace packages are inlined.
FROM node:24-slim AS build
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
# The package store is a build cache every image shares, and 'locked' makes
# the seven installs take turns (decision 176): one download, not seven at once.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store,sharing=locked \
    pnpm install --frozen-lockfile --store-dir /pnpm/store --filter @cujo/harness...
RUN pnpm --filter @cujo/harness build
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store,sharing=locked \
    pnpm --filter @cujo/harness deploy --prod --store-dir /pnpm/store /out

FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8790 \
    HARNESS_DATA_DIR=/data
COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/apps/harness/dist ./dist
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8790
CMD ["node", "dist/index.js"]
