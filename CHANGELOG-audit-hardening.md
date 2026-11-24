# Audit & hardening update

Nothing here changes how stock is counted, and no existing data is rewritten. The schema changes are
additive and idempotent (safe to run on your live database; verified on a seeded copy, run twice).

## Bugs fixed
- **Event dates**: the API sent dates as `2026-11-20T00:00:00.000Z`. The Edit Event form could not show
  that (date boxes appeared empty, so editing forced re-typing both dates) and on a server not set to UTC
  the day shifted by one. Dates are now plain `YYYY-MM-DD`.
- **Double-click on Receive Stock booked the stock twice** (no in-flight guard). Fixed; the Units and Events
  forms had the same gap.
- **Editing an item through the API without `itemType`** silently turned a kit into a consumable and archived
  its piece list. A missing type now keeps the current one.
- Bad input used to return **500** instead of a clear 4xx: malformed JSON, `?page=abc`, `?from=garbage`,
  unknown event status, invalid dates, over-long names, bad `piecesPerSet`, a units update without a factor.
- `?lowStock=false` behaved like `true`; `%` / `_` typed in search acted as wildcards.
- Event, unit and item **delete/save buttons failed silently** when the server refused (and staff saw an
  admin-only Delete button). Errors are now shown; Delete is admin-only in the UI.
- A network blip or API restart **signed everyone out**; only a real 401 does now.
- Single-transaction errors no longer echo raw database error text to the browser.

## Data-loss guards
- An **event with stock transactions can't be deleted** (it silently detached its history). Mark it Completed.
- An **item still issued out can't be deleted** (it erased the only record of who holds it).
- An **issue that was already returned can't be deleted** until its returns are (it double-counted stock).
- **Restore takes a safety snapshot first** (`inventory_before_restore_*.sql`), is single-flight, re-applies the
  schema afterwards (old backups brought old table shapes back), and a failed backup no longer leaves a
  truncated `.sql` in the list.
- Database: stock can't go negative (check added only if no row violates it today).
- Duplicate unit names/abbreviations are refused.

## Security
- Login is rate-limited (10 tries / 15 min per person+address), constant-time for unknown users, accepts only
  strings, and JWTs are pinned to HS256. Passwords over bcrypt's 72-byte limit are refused.
- Accounts still on the seeded `admin123` / `staff123` passwords get a banner until changed. The demo
  credentials box on the login page now only shows in `npm run dev`.
- The API starts only with `DATABASE_URL` and `JWT_SECRET`, and warns while the default secret is in use.
- docker-compose: Postgres (5432) and API (4000) are published on **localhost only** (they were open to the
  network with a known password). `JWT_SECRET` / `POSTGRES_PASSWORD` can be set from a `.env` file; defaults
  are the old values so nothing changes until you choose to.
- Backend image no longer contains `.env`; uses `npm ci` from the lockfile.

## Reliability
- Per-query logging was on in production (container logs grew forever): now opt-in (`LOG_QUERIES=1`), and
  compose rotates logs (10 MB x 3).
- Graceful shutdown (`exec node`, SIGTERM handler), healthcheck, unhandled-error logging, JSON 404s.
- nginx: backup/restore no longer cut off at 60 s (504 while the server kept going); `index.html` is never
  cached (stale page after a release); security headers.
- Frontend: error boundary instead of a blank page; 60 s request timeout; downloads no longer revoked instantly.
- Migration: no longer drops/re-adds a constraint on every start; new index for recipient look-ups.
- Full-data export now includes categories, recipients and the recipient audit trail.

## To do on your side
1. Set a real secret: create `.env` beside `docker-compose.yml` with `JWT_SECRET=$(openssl rand -hex 32)`
   (everyone signs in once more). Change the `admin`/`staff` passwords in Profile.
2. `docker compose up -d --build`. If you reached the API/DB from another machine via :4000/:5432, change the
   `127.0.0.1:` prefix in `docker-compose.yml`.
3. Known, not changed (major upgrades could break PDF export): `npm audit` reports issues in `jspdf` and its
   dependencies (and react-router's SSR-only advisory, not applicable here). Plan a tested upgrade.
