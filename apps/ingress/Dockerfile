# Build context is the repo root (see .dockerignore). Builds the bundled ingress
# service; the runtime image needs no node_modules because tsup inlines the
# workspace dependency.
FROM node:24-slim AS build
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @cujo/ingress build

FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080
COPY --from=build --chown=node:node /repo/apps/ingress/dist ./dist
USER node
EXPOSE 8080
CMD ["node", "dist/index.js"]
