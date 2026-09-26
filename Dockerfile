# Room Flythrough Studio — Online-Betrieb (Web-UI + API + Render auf einem Port)
FROM node:22-bookworm-slim

# Systembibliotheken für Remotions Headless-Chrome (siehe remotion.dev/docs/docker)
RUN apt-get update && apt-get install -y --no-install-recommends \
      libnss3 libdbus-1-3 libatk1.0-0 libgbm-dev libasound2 libxrandr2 libxkbcommon-dev \
      libxfixes3 libxcomposite1 libxdamage1 libatk-bridge2.0-0 libpango-1.0-0 libcairo2 libcups2 \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN corepack pnpm install --frozen-lockfile

COPY . .
RUN corepack pnpm run build \
    && corepack pnpm exec remotion browser ensure

ENV HOST=0.0.0.0 PORT=4300
EXPOSE 4300
# uploads/, out/ und jobs/ als Volume mounten, damit sie Neustarts überleben
VOLUME ["/app/uploads", "/app/out", "/app/jobs"]
CMD ["node", "server/index.mjs"]
