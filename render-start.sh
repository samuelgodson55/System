#!/bin/sh
# =============================================================================
# render-start.sh  --  container entrypoint for Dockerfile.render
# -----------------------------------------------------------------------------
# Render's free plan has no pre-deploy command or job runner, so schema migration and first-run seeding
# happen here, on every start, before the API opens its port. Both steps are idempotent:
#   - db/migrate.js applies the schema with IF NOT EXISTS / additive statements (a no-op when up to date)
#   - db/seed.js does nothing once a user exists, so a restart or redeploy never touches real data
# A free web service spins down after 15 idle minutes and cold-starts on the next request, so this
# runs often; it is cheap.
# =============================================================================
set -eu

# The database is normally ready already (it is a separate always-on service), but a brand-new
# Blueprint creates it at the same time as this service, so allow a short wait instead of crashing.
attempt=1
max_attempts=10
until node src/db/migrate.js; do
  if [ "$attempt" -ge "$max_attempts" ]; then
    echo "render-start: migration still failing after $max_attempts attempts - giving up" >&2
    exit 1
  fi
  echo "render-start: migration failed (attempt $attempt/$max_attempts), retrying in 5s..." >&2
  attempt=$((attempt + 1))
  sleep 5
done

node src/db/seed.js

# exec: node becomes PID 1 so Render's SIGTERM on deploy/spin-down reaches it and it shuts down cleanly
echo "render-start: starting API on port ${PORT:-10000}"
exec node src/index.js
