# Build context is the repo root (see .dockerignore). Builds the bundled
# ocr-sidecar service; the runtime image needs no node_modules because tsup
# inlines the workspace dependency.
#
# Unlike the other Node services this one carries two binaries: git, which
# `ocr` needs at 2.41 or later (bookworm ships 2.39, trixie 2.47), and `ocr`
# itself from Alibaba's GitHub release, pinned by tag and by the checksum of
# each architecture's asset. The image stays read-only with every capability
# dropped: a review clones into a tmpfs and leaves nothing behind.
FROM node:24-slim AS build
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN pnpm install --frozen-lockfile --filter @cujo/ocr-sidecar...
RUN pnpm --filter @cujo/ocr-sidecar build

FROM node:24-trixie-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8083
ARG TARGETARCH
ARG OCR_VERSION=v1.12.0
ARG OCR_SHA256_AMD64=0e71d2bbea71fbc9a76a999b9ecabb2c63d1efca36ab490db727ba7450444def
ARG OCR_SHA256_ARM64=e69c695c85e301b754940f743b13e9122562e17c6eaedadb9a259ec7415b7be9
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates curl \
  && case "${TARGETARCH}" in \
       amd64) sum="${OCR_SHA256_AMD64}" ;; \
       arm64) sum="${OCR_SHA256_ARM64}" ;; \
       *) echo "unsupported TARGETARCH ${TARGETARCH}" >&2; exit 1 ;; \
     esac \
  && curl -fsSL -o /tmp/ocr \
       "https://github.com/alibaba/open-code-review/releases/download/${OCR_VERSION}/opencodereview-linux-${TARGETARCH}" \
  && echo "${sum}  /tmp/ocr" | sha256sum -c - \
  && install -m 0755 /tmp/ocr /usr/local/bin/ocr \
  && rm -f /tmp/ocr \
  && apt-get purge -y curl \
  && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=node:node /repo/apps/ocr-sidecar/dist ./dist
USER node
EXPOSE 8083
CMD ["node", "dist/index.js"]
