FROM docker:29-cli AS docker-client
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=docker-client /usr/local/bin/docker /usr/local/bin/docker
WORKDIR /app
COPY package.json server.mjs cloud.mjs ./
COPY dist ./dist
ENV NODE_ENV=production RELAY_BIND=0.0.0.0 RELAY_DATA_DIR=/data RELAY_EXECUTION=docker PORT=4310
EXPOSE 4310
CMD ["node", "server.mjs"]
