# Build context is the repo root (see .dockerignore). Three stages, because
# this service carries an engine it compiles itself.
#
# `codebase-memory-mcp` is MIT C with every dependency vendored — 163
# tree-sitter grammars and a 31 MB embedding blob — so the compile needs a
# toolchain and zlib and nothing from the network once the source is there.
# It is built here rather than downloaded (decision 172): the binary indexes
# other people's code, and a release asset is a thing we would be trusting
# rather than a thing we made.
#
# The clone is shallow and the commit is pinned. Bumping it is a one-line
# change and a rerun of the spike's probes, never a silent follow of a
# branch.
# Trixie, to match the runtime below. The engine links against the glibc of
# whatever built it, and a bookworm runtime cannot load a trixie binary
# (GLIBC_2.38 not found) -- which the image's own boot check cannot see,
# because the bundle loads perfectly well and only the engine is unusable.
FROM debian:trixie-slim AS engine
ARG CBM_COMMIT=59a05eb1bf9e11deb060d782cd7d3a29f2ae2866
WORKDIR /src
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
       build-essential zlib1g-dev git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN git init --quiet . \
  && git remote add origin https://github.com/DeusData/codebase-memory-mcp.git \
  && git fetch --depth 1 --quiet origin "${CBM_COMMIT}" \
  && git checkout --quiet FETCH_HEAD
# Without --with-ui: this is a server, and the graph UI is a browser toy that
# would pull node into a stage that has no other use for it.
RUN scripts/build.sh \
  && strip build/c/codebase-memory-mcp || true

FROM node:24-slim AS build
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
# Filtered so apps/web's dependencies stay out of this image.
RUN pnpm install --frozen-lockfile --filter @cujo/mapper...
RUN pnpm --filter @cujo/mapper build

# trixie and not slim: the engine is built against this glibc. `ocr-sidecar`
# reaches for the same base for the same kind of reason.
FROM node:24-trixie-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8084 \
    CUJO_MAPPER_DIR=/data/repos \
    CUJO_MAPPER_CACHE_DIR=/data/graphs
# git builds the repository the engine reads; tar unpacks the trees that
# become it. Both are the engine's inputs, not its network.
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=node:node /repo/apps/mapper/dist ./dist
# Last, and on its own layer: the engine is about 300 MB and changes only
# when the pin does, so every other rebuild leaves it alone.
COPY --from=engine /src/build/c/codebase-memory-mcp /usr/local/bin/codebase-memory-mcp
RUN mkdir -p /data/repos /data/graphs && chown -R node:node /data
USER node
EXPOSE 8084
CMD ["node", "dist/index.js"]
