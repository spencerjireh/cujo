# Build context is the repo root (see .dockerignore). Builds the bundled cujo
# service; the runtime image needs no node_modules because tsup bundles every
# dependency.
FROM node:24-slim AS build
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
# Filtered so adding apps/web to the workspace does not pull Next, React, and
# Storybook into this image's install.
RUN pnpm install --frozen-lockfile --filter @cujo/cujo...
RUN pnpm --filter @cujo/cujo build

FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    CUJO_DB_PATH=/data/cujo.db
COPY --from=build --chown=node:node /repo/apps/cujo/dist ./dist
# The rubric is read at runtime from agent/SKILL.md next to dist/.
COPY --chown=node:node agent ./agent
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]
USER node
EXPOSE 8080
CMD ["node", "dist/index.js"]
