# Build context is the repo root (see .dockerignore). Builds the bundled
# sandbox-mcp service; the runtime image needs no node_modules because tsup
# inlines the workspace dependency.
#
# Unlike every other service here, this image needs the `docker` client: the
# local runtime provisions a container, a gateway and a network per sandbox, and
# it shells out to do it. That is also why the compose entry cannot carry
# `read_only` and `cap_drop: ALL` -- see decision 114, which argues the trade
# rather than hiding it.
FROM node:24-slim AS build
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN pnpm install --frozen-lockfile --filter @cujo/sandbox-mcp...
RUN pnpm --filter @cujo/sandbox-mcp build

FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8082
# The client only. The daemon is the host's, reached through its socket.
RUN apt-get update \
  && apt-get install -y --no-install-recommends docker.io \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=node:node /repo/apps/sandbox-mcp/dist ./dist
EXPOSE 8082
CMD ["node", "dist/index.js"]
