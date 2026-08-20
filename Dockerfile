# syntax=docker/dockerfile:1

ARG NODE_VERSION=22-alpine

FROM node:${NODE_VERSION} AS client-deps
WORKDIR /app
ENV NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_FUND=false
COPY package*.json ./
RUN npm ci

FROM client-deps AS client-dev
ENV NODE_ENV=development
COPY index.html ./
COPY vite.config.js jsconfig.json ./
COPY public ./public
COPY serve/src/shared ./serve/src/shared
COPY src ./src
EXPOSE 5173
CMD ["npm", "run", "dev"]

FROM node:${NODE_VERSION} AS server-deps
WORKDIR /app/serve
ENV NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_FUND=false
COPY serve/package*.json ./
RUN npm ci

FROM server-deps AS server-dev
ENV NODE_ENV=development
COPY serve ./
EXPOSE 2567
CMD ["npm", "run", "start"]

FROM client-deps AS client-build
COPY index.html ./
COPY vite.config.js jsconfig.json ./
COPY public ./public
COPY serve/src/shared ./serve/src/shared
COPY src ./src
RUN npm run build

FROM server-deps AS server-build
COPY serve ./
RUN npm run build

FROM node:${NODE_VERSION} AS simulator-runtime
ENV NODE_ENV=production
WORKDIR /app/serve

COPY serve/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=server-build /app/serve/build ./build

CMD ["npm", "run", "sim:start:prod"]

FROM node:${NODE_VERSION} AS runtime
ENV NODE_ENV=production
ENV PORT=2567
ENV CLIENT_DIST_DIR=/app/dist
WORKDIR /app/serve

COPY serve/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=server-build /app/serve/build ./build
COPY --from=client-build /app/dist /app/dist

EXPOSE 2567
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 2567) + '/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["npm", "run", "start:prod"]

