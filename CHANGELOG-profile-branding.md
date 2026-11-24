# Profile & branding update

## My profile (everyone)
- Click your name at the bottom of the sidebar -> **My profile**.
- Edit display name, username and password.
- Changing the username or password requires the current password. New password: min. 8 characters. Usernames are 3-50 characters (letters, numbers, . _ -) and must be unique (case-insensitive).
- A fresh sign-in token is issued after saving, so you stay logged in.
- `GET /api/auth/me` now reads the live account (a renamed user shows the new name everywhere; a deleted user is signed out).
- New endpoint: `PUT /api/auth/profile`.

## Company branding (admin)
- New **Settings** page (admin only): company name and site location.
- Shown on the sign-in page, sidebar, page header, browser tab title, and at the top of every CSV / PDF export.
- Until a name is set, the app looks exactly as before.
- New endpoints: `GET /api/settings/branding` (public, needed by the login page), `PUT /api/settings/branding` (admin).

## Safe upgrade
- One additive migration: `CREATE TABLE IF NOT EXISTS app_settings`. No existing table or column is changed, no data is touched, and it is safe to run repeatedly.
- The seed step only runs on an empty database, so renaming `admin` can never bring back a default `admin/admin123` account.
- Backups (`pg_dump`) include the new table automatically; old backups restore fine.
- Removed the stray unused `backend/src/db/migrate.tmp.js`.

## Upgrade steps
1. Back up first (Backups page, or `pg_dump`).
2. `docker compose up -d --build` (keep the `pgdata` volume - do NOT use `down -v`).
3. The backend runs the migration on start-up. Log in and open Settings.
