# Production image: installs the published @truefoundry/trueforge from npm.
# Hosted mode (Postgres + Redis) is selected via STANDALONE=false.
FROM node:24-slim AS runner
WORKDIR /app

# HOST=0.0.0.0 so Traefik/healthchecks reach the process inside the container.
ENV NODE_ENV=production \
    STANDALONE=false \
    HOST=0.0.0.0

RUN npm install --omit=dev "@truefoundry/trueforge@0.1.4" \
  && npm cache clean --force

EXPOSE 8790

CMD ["node", "node_modules/@truefoundry/trueforge/dist/main.js"]
