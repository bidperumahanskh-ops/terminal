# Terminalku — image produksi (ringan, multi-stage)
FROM node:22-alpine AS build
WORKDIR /app
# node-pty butuh build tools saat kompilasi native
RUN apk add --no-cache python3 make g++ bash
# Hindari timeout IPv6 saat node-gyp download headers
ENV NODE_OPTIONS=--no-network-family-autoselection
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Terminalku — image produksi berbasis Debian Bookworm Slim
# Memakai glibc agar binary native host (seperti Python/Hermes) dapat berjalan langsung
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ bash
ENV NODE_OPTIONS=--no-network-family-autoselection
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
# Utilitas sistem lengkap setara host: bash, coreutils (dir/vdir), curl, git, file, less, nano, procps
RUN apt-get update && apt-get install -y --no-install-recommends \
    bash coreutils curl git file less nano procps ca-certificates util-linux \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/node_modules ./node_modules
COPY server ./server
COPY public ./public
RUN mkdir -p /app/data && chown -R node:node /app
# USER node dinonaktifkan agar container berjalan dengan user/group dari docker-compose
EXPOSE 3000
CMD ["node", "server/index.js"]