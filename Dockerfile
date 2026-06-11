# syntax=docker/dockerfile:1

FROM node:22-alpine AS client-deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM client-deps AS client-build
COPY index.html ./
COPY public ./public
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
CMD ["npm", "run", "start:prod"]
