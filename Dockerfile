FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# De Eufy livestream is een korte live raw-video pipe. FFmpeg wacht standaard
# lang met streamanalyse, waardoor er bij deze deurbel geen frames uitkwamen
# voordat de stream alweer stopte. Deze wrapper dwingt een snelle analyse af.
RUN printf '%s\n' \
    '#!/bin/sh' \
    'exec /usr/bin/ffmpeg -probesize 32768 -analyzeduration 0 "$@"' \
    > /usr/local/bin/ffmpeg \
    && chmod +x /usr/local/bin/ffmpeg

WORKDIR /app

COPY src ./src
COPY public ./public

ENV NODE_ENV=production

CMD ["node", "src/server.mjs"]
