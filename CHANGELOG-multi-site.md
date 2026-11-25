# Multiple sites (stores / locations) under one platform

One company can now run several sites in the same app. Each site keeps its **own stock, events, issues, returns,
faults and reports**. Staff work only in the site assigned to them; admins switch between sites from the header.

## What changed for people
- **Admin**
  - New **Sites** page: add a site (optionally starting from another site's item list at **zero stock**), rename it,
    deactivate / reactivate it, delete it when it is completely empty.
  - A **site switcher** in the header. Every screen (Inventory, Receive, Issue, Return, Daily Issues, Events, Faulty
    Items, Reports & Exports) shows the site selected there. The choice is remembered in the browser.
  - **Dashboard → All sites** table: items, low stock, open faults, live events and 30-day movements side by side.
  - **Users page:** every staff account has a **Site**. Moving someone to another site signs them out once.
- **Staff**
  - Locked to their site. They see its name in the header, and nothing in the screens or the API reaches another site.
- **Reports / exports** cover the selected site only; CSV files and PDFs carry the site name (and the file name).

## Existing installations: nothing is lost, nothing changes on day one
On the first start the migration (automatic, idempotent) creates **one default site** (named after the old
"Site location" setting, otherwise "Main Site") and puts **all existing items, events and staff in it**. The
transaction ledger is not touched at all (a ledger line belongs to the site of its item). Admins stay unassigned.
Until a second site is added, people see the same app as before.

## How it works (so it is easy to reason about)
| Topic | Rule |
|---|---|
| Stock | An **item belongs to exactly one site**. The same product at two sites is two items with the same SKU. All stock maths (units, kits, balances, returns) is unchanged because it is keyed by item. |
| SKU | Unique **per site** (was global). Auto-SKUs count per site. |
| Events | Belong to a site; stock can only be booked against an event of the same site. |
| Shared company-wide | Categories, units of measurement and the recipients list. |
| Users | Staff: exactly one site. Admin: none (all sites). |
| Deactivated site | Read-only for everybody (`403 SITE_INACTIVE` on any change); history is kept. At least one site stays active. |

## Security model (server-enforced, not just hidden buttons)
- `middleware/site.js` runs on every stock route. **Staff:** the site is the one on their account; the `X-Site-Id`
  header is ignored. **Admin:** the header picks the site (no header = default site, so old browser tabs keep working).
- Every query is filtered by that site. An id from another site (item, event, fault, ledger line) answers **404**,
  never 403, so other sites' records are not even confirmed to exist.
- Covered: items (list, stats, get/put/delete/repack), transactions (list, daily, outstanding, single, kit, return-batch,
  bulk issue/receive, delete), events, faults, all exports and the Daily Issues / Return screens.
- `GET /api/recipients/:id/usage` (ledger counts across all sites) is now admin-only.

## API additions
| Method | Path | Notes |
|---|---|---|
| GET | `/api/sites` | Admin: all sites with counts · staff: their own site |
| GET | `/api/sites/overview` | Admin: per-site headline numbers |
| POST | `/api/sites` | Admin: `{ name, address?, copyCatalogueFrom? }` |
| PUT | `/api/sites/:id` | Admin: `{ name?, address?, isActive? }` |
| DELETE | `/api/sites/:id` | Admin: only when the site has no items, events or staff |
| — | header `X-Site-Id` | Admin: the site a request works in |
| PUT/POST | `/api/users` | now accept `siteId` (required for staff) |

## Backups
Backups are whole-database dumps, so they include sites. Restoring a backup made **before** this update works: the
schema refresh that already follows every restore re-creates the site columns and puts the restored data in the
default site (tested).

## Deploy
Rebuild and restart as usual (`docker compose up -d --build`, or push to Render). The migration runs by itself.
Take a **Backup** from the Backups page first, as always before an upgrade.

## Tested
Migration on a seeded pre-update database (data checksum identical before/after, second run is a no-op); an
old-format backup restored onto the new schema; ~70 API checks covering isolation between two sites for staff and admin
(read, write, bulk, kit, return, delete, events, faults, exports), SKU rules, deactivation and moving staff.
