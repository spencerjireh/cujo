# Build context is the repo root (see .dockerignore). Builds the bundled
# github-mcp service; the runtime image needs no node_modules because tsup
# inlines the workspace dependency.
FROM node:24-slim AS build
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
# Filtered so the new apps/web dependencies stay out of this image.
RUN pnpm install --frozen-lockfile --filter @cujo/github-mcp...
RUN pnpm --filter @cujo/github-mcp build

FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8081
COPY --from=build --chown=node:node /repo/apps/github-mcp/dist ./dist
USER node
EXPOSE 8081
CMD ["node", "dist/index.js"]
