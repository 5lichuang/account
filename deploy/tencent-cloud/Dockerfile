FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --include=dev --no-audit --no-fund

COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    WRANGLER_LOG_PATH=/tmp/wrangler.log

WORKDIR /app

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./package.json

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/healthz').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["node", "./node_modules/vinext/dist/cli.js", "start", "--hostname", "0.0.0.0", "--port", "3000"]
