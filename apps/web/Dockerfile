# Build context is the repo root (see .dockerignore), like apps/cujo.
#
# Unlike cujo, which tsup bundles into a single file, Next needs its traced
# node_modules, so the runner copies .next/standalone. `brand` is copied because
# @cujo/brand is a workspace dependency and globals.css imports its tokens.
FROM node:24-slim AS build
WORKDIR /repo
RUN corepack enable
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY packages ./packages
COPY brand ./brand
COPY apps ./apps
RUN pnpm install --frozen-lockfile --filter @cujo/web...
RUN pnpm --filter @cujo/web build

FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1
# standalone mirrors the monorepo tree because outputFileTracingRoot is the repo
# root. Static assets and public/ are not traced into it, so they are copied.
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
