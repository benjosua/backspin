# syntax=docker/dockerfile:1

FROM node:22-alpine AS client-deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM client-deps AS client-build
COPY index.html ./
COPY vite.config.js jsconfig.json ./
COPY public ./public
COPY shared ./shared
COPY my-server/src/shared ./my-server/src/shared
COPY src ./src
RUN npm run build

FROM node:22-alpine AS server-deps
WORKDIR /app/my-server
COPY my-server/package*.json ./
RUN npm ci

FROM server-deps AS server-build
COPY my-server ./
RUN npm run build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
ENV PORT=2567
ENV CLIENT_DIST_DIR=/app/dist
WORKDIR /app/my-server

COPY my-server/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=server-build /app/my-server/build ./build
COPY --from=client-build /app/dist /app/dist

EXPOSE 2567
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 2567) + '/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["npm", "run", "start:prod"]
