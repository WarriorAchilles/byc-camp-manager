# syntax=docker/dockerfile:1

# --- Build: install workspaces, generate Prisma client, compile server + client ---
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY client/package.json client/package.json
RUN npm ci
COPY server server
COPY client client
RUN npm run db:generate -w server \
  && npm run build -w server \
  && npm run build -w client

# --- Run: production dependencies + compiled output ---
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY client/package.json client/package.json
RUN npm ci --omit=dev
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/server/prisma ./server/prisma
COPY --from=build /app/client/dist ./client/dist
ENV CLIENT_DIST_PATH=/app/client/dist
EXPOSE 4000
WORKDIR /app/server
CMD ["node", "dist/index.js"]
