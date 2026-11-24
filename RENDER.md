# Deploying to Render (free plan)

The Blueprint in `render.yaml` creates a free **PostgreSQL** database and **one free web service** that runs
the API *and* serves the React app (`Dockerfile.render`). Everything is same-origin: the browser calls `/api`
on the site's own address, so there is no CORS or API-URL setup.

```
Browser ──HTTPS──▶ inventory-web (Express: /api/* + static React app) ──private network──▶ inventory-db (Postgres 16)
```

## Why one service?

Docker Compose runs three containers (Postgres, API, nginx). Render's free plan only has web services,
Postgres and Key Value, and one free web service cannot be reached privately by another, so a separate
"frontend" and "backend" would not be able to talk to each other. Serving the built frontend from the API
solves that with no extra cost, and nginx's job (static files, `index.html` fallback, caching, compression) is
done in `backend/src/index.js` (switched on by `SERVE_FRONTEND=true`).
Docker Compose is unchanged and still works as before.

## Deploy

1. Push this folder to its own GitHub/GitLab repository (the repo root must contain `render.yaml`,
   `Dockerfile.render`, `backend/` and `frontend/`). If the project sits in a subfolder of a bigger repo, set
   `rootDir` in `render.yaml` or move it to the root.
2. In Render: **New → Blueprint**, pick the repository, and apply. Render creates `inventory-db` and
   `inventory-web`, builds the image (about 3–6 minutes the first time) and starts it.
3. Open the service URL (`https://inventory-web-xxxx.onrender.com`).
4. Sign in as **`admin`**. The password was generated for you: Render dashboard → **inventory-web →
   Environment → `SEED_ADMIN_PASSWORD`** (click the eye icon).
5. Change that password (**My profile**), then create a set of **recovery codes** and store them safely.
   Add staff accounts on the **Users** page.

Subsequent pushes redeploy automatically (`autoDeploy: true`). The schema is migrated on every start, and
seeding only happens when the database has no users, so redeploys never touch existing data.

## Want the demo data?

Set `SEED_DEMO_DATA` to `true` in `render.yaml` **before the first deploy** (or in the dashboard, then
**Manual Deploy → Clear build cache & deploy** on a fresh database). It adds sample items/events and a `staff`
account. Set `SEED_STAFF_PASSWORD` as well, otherwise `staff` gets the publicly documented password `staff123`.
Seeding runs once only; changing the variable later does not alter an existing database.

## Environment variables

| Variable | Set by | Purpose |
|---|---|---|
| `DATABASE_URL` | Blueprint (from the database) | Internal Postgres URL |
| `JWT_SECRET` | Render (generated) | Signs login tokens; changing it signs everyone out |
| `SEED_ADMIN_PASSWORD` | Render (generated) | First-start password of `admin` (min. 8 chars) |
| `SEED_DEMO_DATA` | Blueprint (`false`) | `true` adds sample data and a `staff` user on first start |
| `SERVE_FRONTEND`, `FRONTEND_DIR`, `NODE_ENV` | Dockerfile | Serve the React app from the API |
| `TRUST_PROXY` | Blueprint (`1`) | Proxy hops in front of the API (correct client IP for login rate limiting) |
| `DATABASE_SSL` | you, optional | `true` only when using Render's *external* database URL |
| `CORS_ORIGINS` | you, optional | Comma-separated allowed origins; unneeded for same-origin |
| `DB_POOL_MAX` | you, optional | Connection pool size (default 20) |
| `LOG_QUERIES` | you, optional | `1` logs every SQL query |

## Free-plan limits (what to expect)

| Limit | What it means | What to do |
|---|---|---|
| **Sleeps after 15 min idle** | First request afterwards takes ~1 minute | Fine for occasional use. A free uptime monitor (e.g. UptimeRobot) pinging `/api/health` every 5 min keeps it warm, but uses up the shared 750 free instance-hours/month much faster than idle sleeping does. |
| **Free Postgres expires after 30 days** | Render deletes it after a 14-day grace period unless you upgrade | Download a backup before then (see below) or upgrade `inventory-db` to a paid plan; the app needs no changes. Verify the current terms at <https://render.com/docs/free>. |
| **Ephemeral disk** | Files in `/app/backups` disappear on restart/redeploy/spin-down | After **Backups → Create backup**, immediately use **Download** and keep the `.sql` file elsewhere. To restore a downloaded file, use **Backups → Upload & Restore** (works on a fresh or empty database too). Command-line alternative: run `psql "<External Database URL>?sslmode=require" -f backup.sql` from your computer (the dumps use `--clean --if-exists`, so they are safe to apply to an empty database). |
| **0.1 CPU / 512 MB RAM** | Login (bcrypt) and PDF/CSV exports are slower than on your laptop | Fine for small teams; upgrade the web plan if it feels slow. |
| **No pre-deploy job** | Migrations can't run as a separate step | Done automatically in `render-start.sh` at every start (idempotent). |

> **Backups & data safety:** the free database is a *trial*, not durable storage. If the inventory matters,
> schedule a regular manual backup download, or move to a paid database.

## Troubleshooting

- **Deploy fails at "migration still failing"**: check the logs. Most often `DATABASE_URL` points to a database in a
  different region. Keep both `region:` values identical.
- **`pg_dump: server version mismatch`** on Backups: the database major version is newer than the `postgresql16-client`
  in `Dockerfile.render`. Bump that package (e.g. `postgresql17-client`) and `postgresMajorVersion` together.
- **Connecting from your computer** (psql / a GUI): use the database's *External* URL and set `DATABASE_SSL=true`
  on the app only if the *app* ever uses it; psql needs `sslmode=require`.
- **Forgot the admin password**: use the recovery codes; as a last resort, open the database **Shell** and follow
  the "worst case" steps in `README.md`.
- **Test the exact production image locally:**
  ```bash
  docker build -f Dockerfile.render -t inventory-render .
  docker run --rm -p 10000:10000 \
    -e DATABASE_URL=postgresql://inventory:inventory@host.docker.internal:5432/inventory \
    -e JWT_SECRET=$(openssl rand -hex 32) -e SEED_DEMO_DATA=false -e SEED_ADMIN_PASSWORD=ChangeMe123 \
    inventory-render
  ```
