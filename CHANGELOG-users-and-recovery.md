# Staff limits, user management and admin recovery codes

## Staff can no longer
- edit **recipients** (name / department – this also rewrote past records) – `PUT /api/recipients/:id` is admin-only
- edit or delete **events** – `PUT` / `DELETE /api/events/:id` are admin-only (staff can still create events and book stock to them)

Buttons are hidden for staff; the server enforces it (`403`). The earlier item-edit / category-manage limits are unchanged.

## Users page (admin only)
- Add users, change a role, reset someone's password, remove a user.
- New accounts and resets use a random **temporary password shown once**; the person must choose their own at first sign-in (the server blocks everything else until they do).
- Every change re-asks for the acting admin's own password (rate-limited).
- You can't change your own role or remove yourself; the last admin can never be demoted or removed.
- A reset / role change / removal signs the person out everywhere. Changing your own password signs your *other* sessions out.
- Security events are logged as `[security] …` (no secrets).

## Admin recovery codes
- *My profile → Account recovery codes*: 10 one-time codes (`XXXX-XXXX-XXXX`, 60 bits each), shown once with Copy / Download / Print.
- Stored only as bcrypt hashes; each works once; a new set replaces the old one.
- *Forgot your password?* on the sign-in page: username + code + new password. Rate-limited (5 tries / 15 min per person+address), identical error for every failure, burns the code, signs out old sessions.
- Admins with no codes see a reminder banner.

## Upgrade safety
- **Database:** four additive columns on `users` (`must_change_password`, `token_version`, `recovery_codes`, `recovery_codes_generated_at`), added by the normal idempotent migration on container start. No new table or foreign key, so restoring an older backup still works (the schema refresh after a restore re-adds the columns). Nothing is rewritten.
- **Sessions:** tokens issued before the upgrade keep working (a missing `tv` counts as version 0). Nobody is signed out.
- **Login middleware** now reads the account on every request (one primary-key lookup) so roles and sign-outs apply immediately.
- Password and exports: hashes and codes never leave the database (`/api/exports/full` and the users export use explicit column lists).

## Deploy
`docker compose up -d --build` – the migration runs by itself. Then each admin should create their recovery codes.
