FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Snelle analyse voor de korte Eufy raw-videostream.
RUN printf '%s\n' \
    '#!/bin/sh' \
    'exec /usr/bin/ffmpeg -probesize 32768 -analyzeduration 0 "$@"' \
    > /usr/local/bin/ffmpeg \
    && chmod +x /usr/local/bin/ffmpeg

WORKDIR /app

COPY src ./src
COPY public ./public
COPY start.sh ./start.sh
RUN chmod +x /app/start.sh

ENV NODE_ENV=production

CMD ["/app/start.sh"]
