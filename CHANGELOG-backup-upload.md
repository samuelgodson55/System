# Backup upload & restore

Problem: backups could be downloaded but not uploaded again; on Render the disk is wiped on restart, so a downloaded backup could not be restored from the app.

- **Backups → Upload & Restore**: choose a downloaded `.sql`, it is uploaded (progress shown), validated, then the restore confirmation opens.
- Backend `POST /api/backups/upload`: streamed to disk (not held in memory), size limit `BACKUP_UPLOAD_MAX_MB` (default 200), written under a temp name and only renamed after validation.
- Security: an uploaded file is run through `psql`, so it is scanned first: must be a pg_dump of this system (users + items tables), no psql backslash commands (`\!` etc.), COPY only from stdin, no roles/databases/other extensions; truncated files are rejected.
- Restore still snapshots the current data first (`inventory_before_restore_…`) and runs in one transaction.
- "Also download a copy when I create a backup" (on by default) because hosted disks can be ephemeral.
- List shows "uploaded" / "auto, before restore" tags.
- nginx (Docker Compose): `/api/backups` now allows large bodies, unbuffered, 10 min timeouts. Render needs no change.
- No database changes, no new dependencies.

## Fix: upload failed with "403" on Render (worked locally)

Cause: Render sits behind a firewall (Cloudflare) that rejects request bodies containing SQL text with a bare 403 before the request reaches the app. Locally there is no such firewall.

- The browser now gzip-compresses the `.sql` before uploading (`CompressionStream`), so the SQL never travels as plain text; it is also much smaller/faster.
- The API unpacks it while streaming (`X-Upload-Encoding: gzip`); the size limit and the safety scan apply to the unpacked data (gzip-bomb safe). A damaged archive gets a clear 400.
- Plain uploads still work (browsers without `CompressionStream`, curl).
- A non-JSON 403/413 from a proxy now shows an explanatory message instead of "Upload failed (403)".
