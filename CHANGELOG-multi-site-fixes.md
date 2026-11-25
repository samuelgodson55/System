# Multi-site review: bugs found and fixed

The multi-site feature was reviewed end to end and tested against a real PostgreSQL database
(fresh install, repeated migration, a pre-multi-site backup restored onto the new schema, a new-format backup
round trip, and ~60 API checks covering isolation between two sites for staff and admin).
The site isolation itself held up everywhere; the problems below were around it.

## Fixed
1. **Forced password change broke the site screen (frontend).** A new or reset staff account must change its
   temporary password first, and until then the API answers only `/auth/*`. The site list could not be read, so after the
   password was changed the person saw a red "No site assigned" banner and no site name until they reloaded the page.
   `SiteContext` now waits for the password change and then loads the sites by itself; the banner is not shown meanwhile.
2. **Pages loaded twice and could call the API with a stale site (frontend).** Screens were mounted before the working
   site was known, fired their requests, and were then remounted when it arrived. An admin whose remembered site had
   been deleted got "Site not found" errors flashing on every screen. The layout now shows a spinner until the site is
   known, so each screen loads once, for the right site.
3. **Two admins could leave the system with no active site (backend).** Deactivating two different sites at the same
   moment each saw the other as still active and both succeeded. Deactivating and deleting sites is now serialised with
   an advisory lock (`routes/sites.js`).
4. **Renaming a staff account that has no site failed (backend).** `PUT /api/users/:id` demanded a site even for a plain
   rename. A site is now required only when the site or the role is actually being changed (`routes/users.js`).

## Checked and found correct (no change)
Item / event / fault / ledger / kit / return / bulk / export isolation (404 across sites, header ignored for staff),
per-site SKUs, catalogue copy (units, per-item factors and kit pieces copied identically, zero stock), deactivated sites
read-only, staff moves sign the person out, old-format backup restore, schema migration idempotency.

## Deploy
No database change. Rebuild and restart as usual.
