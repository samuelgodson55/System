# Render free-plan deployment

**Added**
- `render.yaml` (Blueprint), `Dockerfile.render` (single image), `render-start.sh` (migrate + seed + start), root `.dockerignore`, `RENDER.md`.

**Backend changes (Docker Compose behaviour unchanged)**
- `SERVE_FRONTEND=true`: the API serves the built React app (hashed assets cached 1 year, `index.html` never cached, gzip for static files, SPA fallback).
- `db/seed.js`: `SEED_DEMO_DATA=false` creates only the admin + units; `SEED_ADMIN_PASSWORD` / `SEED_STAFF_PASSWORD` replace the public demo passwords. Defaults are unchanged.
- `db/pool.js`: optional `DATABASE_SSL`, `DB_POOL_MAX`.
- `index.js`: optional `CORS_ORIGINS`, `TRUST_PROXY`.
- New dependency: `compression`.
