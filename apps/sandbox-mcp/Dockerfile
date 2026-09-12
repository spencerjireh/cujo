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
#
# From Docker's own repository and pinned, not Debian's `docker.io`: bookworm
# ships client 20.10, which speaks API 1.41, and Engine 29 refuses anything
# below 1.44. Against the deploy host that was every `docker` call failing at
# boot, so the image build failed, the process exited, and the healthcheck
# never saw a 200. The pin tracks the host's engine (29.7.2 when written); a
# newer client talks to an older engine, so bump this before the host, not after.
ARG DOCKER_CLI_VERSION=5:29.7.2-1~debian.12~bookworm
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && install -m 0755 -d /etc/apt/keyrings \
  && curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \
  && chmod a+r /etc/apt/keyrings/docker.asc \
  && echo "deb [signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian bookworm stable" \
    > /etc/apt/sources.list.d/docker.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends "docker-ce-cli=${DOCKER_CLI_VERSION}" \
  && apt-get purge -y curl \
  && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=node:node /repo/apps/sandbox-mcp/dist ./dist
# The two build contexts the local runtime needs, built through that socket at
# boot (decision 118). They are `docker run` per sandbox, never compose
# services, so nothing in `up --build` would build them; carrying the contexts
# here is what makes the sensors a review runs the code this deploy shipped.
# `sandbox/tests/` rides along and is ignored by that Dockerfile's COPY lines.
COPY sandbox ./images/sandbox
COPY apps/sandbox-mcp/gateway ./images/gateway
EXPOSE 8082
CMD ["node", "dist/index.js"]
