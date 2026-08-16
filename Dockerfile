FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY src ./src
COPY public ./public

ENV NODE_ENV=production

CMD ["node", "src/server.mjs"]
