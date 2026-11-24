FROM node:20-alpine

# pg_dump / psql for backups and restores
RUN apk add --no-cache postgresql16-client

WORKDIR /app

# Install exactly the locked versions (reproducible; `npm install` could drift between builds).
# The layer is cached until package.json / package-lock.json change.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY . .

RUN mkdir -p /app/backups

EXPOSE 4000

HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD wget -qO- http://127.0.0.1:4000/api/health >/dev/null || exit 1

# Wait for postgres, migrate, seed, start.
# `exec` makes node the main process so `docker stop` (SIGTERM) reaches it and it can shut down cleanly.
CMD ["sh", "-c", "node src/db/migrate.js && node src/db/seed.js && exec node src/index.js"]
