# Inventory System (Full Stack)

Lightweight containerized inventory manager with **React** frontend, **Express** API, and **PostgreSQL**.

## Features

- Units of measurement with conversion factors. **Each item is counted in its own base unit (pieces, litres, kg …) and chooses which units apply to it** (e.g. pens: piece / pack / carton; a folding table: piece only) – only those appear when receiving, issuing or returning it (see *Units per item* below)
- Receive stock (vendor / head office)
- **Issue stock** (recipient, department) and separate **Return stock** flow
- Return UX: the **Everything out** tab lists all stock currently out (by person or by item, searchable) with a *Return* button on every line and *Return all* per person; **Find by item** is the item → recipient lookup. See *Returning stock* below
- Item types: **consumable**, **reusable**, and **kit** (tool sets e.g. 80-in-1). A kit lists **every piece inside one set**; pieces can be issued/returned **individually** or the **whole kit** can go out with all its pieces logged (see *Kits & tool sets* below)
- **Editable categories**: rename, merge or tidy categories (Inventory → *Categories*, or *Rename / manage* in the item form) – every item in the category follows. See *Categories* below
- **Reusable recipients**: a searchable drop-down on Issue Stock; new names are added while issuing and a recipient's name can be corrected from the same screen. See *Recipients* below
- **Bulk issue & bulk receive**: the *Bulk issue* tab (Issue Stock) and *Bulk receive* tab (Receive Stock) book many items in one all-or-nothing save – search/scan or paste `SKU, qty` lines, review, confirm. See `CHANGELOG-bulk-transactions.md`
- Events + stock usage per event + export
- Search, filters, pagination
- **Item history page** (click an item name) has **Issue**, **Edit** and **Delete** buttons at the top, so stock can be issued or the item edited (same form as on the Inventory list, including units) without going back
- **Customisable inventory columns** (show Available, Issued Out and Total Qty side by side, plus reorder level, last updated, etc.); choice is remembered per browser and used by CSV/PDF export
- **Daily Issues** page: pick a date and see everything issued out that day, with per-item totals and CSV/PDF export
- CSV / PDF export with date range margin
- **Reports & Exports** page plus export buttons on Dashboard, Return Stock, Events and Units: inventory, low-stock list, kit contents, stock currently out, full transaction ledger, events, stock used per event, units, users, and (admin) a complete-data JSON file (see *Exports* below)
- Simple JWT login
- **PostgreSQL** with connection pooling (concurrent-safe stock updates via row locks)
- **Database backups** (admin): create, list, download, **restore**, delete `pg_dump` SQL files

## Quick Start (Docker / WSL Ubuntu)

```bash
cd inventory-system

# Build and start everything (Postgres + API + frontend)
docker compose up --build -d

# First start may take 1–2 minutes (migrate + seed)
docker compose logs -f backend
```

Open: **http://localhost:3000**

| Username | Password  | Role  |
|----------|-----------|-------|
| `admin`  | `admin123`| Admin |
| `staff`  | `staff123`| Staff |

Change both passwords after the first sign-in, then create an admin **recovery code** set (My profile → *Account recovery codes*).

## Deploy for free on Render

`render.yaml` + `Dockerfile.render` deploy the whole app (API, frontend, Postgres) on Render's free plan as one
web service and one database, with a generated admin password and no demo data. See **[RENDER.md](RENDER.md)**
for the steps and the free-plan limits (sleep after 15 min idle, free database expires after 30 days, ephemeral disk).

## Roles & accounts

| | Staff | Admin |
|---|---|---|
| Add items; issue, receive, return stock; repack kits; record faults; reports & exports; add events | ✅ | ✅ |
| Edit / delete items, edit / delete events, rename / delete categories, edit recipients, manage units, delete records | ❌ | ✅ |
| Users (create, change role, assign site, reset password, remove), sites, backups, settings, full export | ❌ | ✅ |

- **Sites:** staff are tied to **one site** and can only see and work with that site's stock, events and reports; admins can switch between all sites (see *Multiple sites* below).
- **Server-enforced:** these rules live in the API (`403 Admin access required`), the screens just hide what a user can't do. The role is read from the database on every request, so a demotion takes effect immediately.
- **Users page (admin):** create accounts (random temporary password shown once, changed at first sign-in), change roles, reset another account's password (signs that person out everywhere), remove accounts. Every change re-asks for your own password. You can't change your own role or remove yourself, and the last admin can't be demoted or removed.
- **Forgot the admin password?** On the sign-in page choose *Forgot your password?* and enter the username, one unused **recovery code** and a new password. Codes are created in *My profile → Account recovery codes* (10 per set, shown once, stored only as hashes, each works once, a new set replaces the old one). Staff who forget their password ask an admin to reset it.
- **Worst case (no admin password and no codes left):** someone with server access can set a temporary password straight in the database (the person must change it at next sign-in, and all their sessions end):
  ```bash
  docker compose exec -T postgres psql -U inventory -d inventory <<'SQL'
  UPDATE users SET password_hash = crypt('NewTempPass1', gen_salt('bf', 10)),
         must_change_password = TRUE, token_version = token_version + 1
   WHERE username = 'admin';
  SQL
  ```
- Security-relevant actions are written to the API log as `[security] …` lines (never passwords or codes).

### Stop

```bash
docker compose down
```

### Persist data

Postgres data lives in the `pgdata` Docker volume. Backups are written to `./backups` on the host.

## Architecture

```
┌─────────────┐     /api/*      ┌─────────────┐         ┌──────────────┐
│  Frontend   │ ──────────────► │   Backend   │ ──────► │  PostgreSQL  │
│  Nginx:3000 │                 │  Express:4000│  pool   │  :5432       │
└─────────────┘                 └─────────────┘         └──────────────┘
                                       │
                                       │ pg_dump
                                       ▼
                                 ./backups/*.sql
```

## Backup (admin only)

1. Sign in as `admin`
2. Open **Backups** in the sidebar
3. Click **Create Backup**
4. Download the `.sql` file (ticked by default: a copy is downloaded automatically)

Restore from a file on your computer: **Backups → Upload & Restore**, choose the `.sql` file, confirm.
The upload is checked first (it must be a pg_dump backup of this system and may not contain psql commands),
and the current data is saved automatically as `inventory_before_restore_…` before anything is replaced.
Upload limit: 200 MB (`BACKUP_UPLOAD_MAX_MB`).

Restore manually:

```bash
psql postgresql://inventory:inventory@localhost:5432/inventory -f backups/inventory_backup_....sql
```

## Development (without full Docker stack)

### Database

```bash
docker compose up postgres -d
```

### Backend

```bash
cd backend
cp .env.example .env
# Point DATABASE_URL at localhost:
# DATABASE_URL=postgresql://inventory:inventory@localhost:5432/inventory
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

### Frontend

```bash
cd frontend
npm install
# Optional: VITE_API_URL=http://localhost:4000/api
npm run dev
```

## Project layout

```
inventory-system/
├── backend/
│   ├── src/
│   │   ├── db/          # pool, migrate, seed
│   │   ├── services/    # kits, per-item units, categories, recipients, mappers
│   │   ├── middleware/  # JWT auth
│   │   ├── routes/      # auth, items, units, events, transactions, backups
│   │   └── index.js
│   ├── Dockerfile
│   └── package.json
├── frontend/            # React + Vite + Tailwind
├── backups/             # SQL dumps (host-mounted)
├── docker-compose.yml
└── README.md
```

## API overview

| Method | Path | Notes |
|--------|------|-------|
| POST | `/api/auth/login` | `{ username, password }` → token |
| PUT | `/api/auth/profile` | edit own name / username / password (current password required for the last two). A new password signs other sessions out |
| GET/POST | `/api/auth/recovery-codes` | Admin: status (`remaining`) / create a new set `{ currentPassword }` → `{ codes }` (shown once) |
| POST | `/api/auth/recover` | Public, rate-limited: `{ username, recoveryCode, newPassword }` – admin password recovery with a one-time code |
| GET/POST | `/api/users` | Admin: list / create `{ username, name, role, password?, adminPassword }` (random temporary password returned once when none is given) |
| PUT/DELETE | `/api/users/:id` | Admin: change `{ role?, name? }` / remove. Both need `adminPassword` |
| POST | `/api/users/:id/reset-password` | Admin: `{ adminPassword, newPassword? }` → `{ temporaryPassword }`; the person must change it at next sign-in |
| GET/POST | `/api/sites` | Admin: list (with counts) / create `{ name, address?, copyCatalogueFrom? }`. Staff get only their own site on `GET` |
| PUT/DELETE | `/api/sites/:id` | Admin: `{ name?, address?, isActive? }` / delete (only an empty site) |
| GET | `/api/sites/overview` | Admin: headline numbers per site |
| GET | `/api/settings/branding` | company name + site location (public) |
| PUT | `/api/settings/branding` | admin only |
| GET/POST/PUT/DELETE | `/api/items` | CRUD inventory. Each item includes `quantity` (available), `outstanding` (issued, not yet returned; reusable/kit only), `totalQuantity` (available + outstanding) and `unitIds` (units enabled for the item; the base unit is always included). `POST`/`PUT` accept `unitIds`; omit it on `PUT` to leave the selection unchanged |
| GET | `/api/categories` | Managed category list `[{ id, name, itemCount }]` (A–Z). `/api/items/categories` (names only) still works |
| POST | `/api/categories` | `{ name }` – add a category with no items yet (re-posting an existing name is harmless) |
| PUT | `/api/categories/:id` | Admin only. `{ name, merge? }` – rename; every item follows. If the name is already another category: `409` with `code: CATEGORY_EXISTS`, resend with `merge: true` to fold this one into it |
| DELETE | `/api/categories/:id` | Admin only. Only when no item uses it (`409` otherwise) |
| GET | `/api/recipients` | Saved recipients `[{ id, name, department }]` (A–Z) |
| PUT | `/api/recipients/:id` | Admin only. `{ name?, department?, merge? }` – rename also renames them on past ledger lines; `409` with `code: RECIPIENT_EXISTS` unless `merge: true`. New recipients are created automatically by issuing (no POST) |
| GET/POST/PUT/DELETE | `/api/units` | Units (global list; which units an item may use is set per item) |
| GET/POST/PUT/DELETE | `/api/events` | Events (`PUT`/`DELETE` admin only) |
| GET | `/api/events/:id/transactions` | Event stock log |
| GET/POST | `/api/transactions` | Issue / receive / return (row-locked) |
| GET | `/api/transactions/outstanding?type=expected\|consumable\|all&groupBy=recipient\|item&search=&days=30&page=&limit=` | Everything that is out across all items, grouped for display (`groups`, `summary`). `type=expected` = reusable + kits (default); consumables are limited to issues in the last `days` days |
| GET | `/api/transactions/outstanding/:itemId` | Who has one item (balance per recipient + department; for consumables: issued minus returned, most recent first) |
| POST | `/api/transactions/return-batch` | `{ recipient, department, itemIds:[…], notes }` – book back everything one person has out for those items, all-or-nothing. Refuses consumables |
| GET | `/api/transactions/daily?date=YYYY-MM-DD&tz=Area/City` | Issues made on that calendar day (in the given time zone) |
| POST | `/api/transactions/kit-issue` | `{ itemId, mode: 'whole'\|'pieces', sets \| lines:[{componentId,quantity}], recipient, department, source, eventId, notes }` |
| POST | `/api/transactions/kit-return` | `{ itemId, sets?, lines?:[{componentId,quantity}], recipient, department, notes }` |
| POST | `/api/transactions/kit-receive` | Receive loose replacement pieces `{ itemId, lines, source, vendor, notes }` |
| POST | `/api/items/:id/repack` | Turn loose pieces back into complete sets |
| GET | `/api/exports` | Catalogue of exportable datasets (admin-only ones hidden from staff) |
| GET | `/api/exports/:dataset?format=csv\|json&from=&to=&tz=&type=&status=&itemType=&category=&search=&outType=&days=` | Datasets: `inventory`, `low-stock`, `kit-contents`, `outstanding`, `transactions`, `events`, `event-usage`, `units`, `users` (admin). CSV is streamed; `json` returns rows for PDF reports (capped at 5,000) |
| GET | `/api/exports/full` | Admin: whole database as JSON (no password hashes). Not a restore file |
| GET/POST | `/api/backups` | List / create (admin) |
| GET/DELETE | `/api/backups/:filename` | Download / delete (admin) |
| POST | `/api/backups/upload` | Upload a `.sql` backup (raw body, `X-Filename` header) (admin) |
| POST | `/api/backups/:filename/restore` | Restore (admin) |

## Multiple sites

One platform, several stores. Each site has its own stock, events, issues, returns and faults; categories, units and the
recipients list are shared.

- **Admin:** *Sites* page to add / rename / deactivate sites; a switcher in the header to work in any site; a per-site
  summary on the Dashboard. Add a site "starting from" another one to copy its item list at zero stock.
- **Staff:** assigned to one site (set on the Users page) and locked to it, enforced by the API.
- **Existing data** is placed in one default site by the automatic migration; nothing else changes until a second site exists.
- Send `X-Site-Id: <site id>` as an admin to pick the site per request (no header = default site). Staff cannot change theirs.
- A SKU is unique per site. A deactivated site is read-only. Details: `CHANGELOG-multi-site.md`.

## Units per item

Units (Piece, Pack, Carton, Dozen …) are defined once under **Units**. Because they don't all make sense for every item, each item has its own list:

- **Inventory → Add/Edit item → Units of measurement**: tick the units that apply. The base unit (Piece) is always on and can't be removed.
- **Receive / Issue / Return** only offer the item's ticked units, and the item page's *Unit Conversions* box only shows them.
- The API enforces it too: a transaction using a unit that isn't enabled for the item is rejected with `400`. Removing a unit from an item never changes its history.
- New items start with the base unit only. Kits that list their pieces are counted in sets/pieces, so the unit picker is hidden for them.
- **Upgrading an existing database:** the migration (run automatically on container start) creates the `item_units` table once and gives every existing item its base unit plus every unit it has already been used with, so nothing stops working. Trim the lists per item afterwards. Restarting never re-adds units you removed.

### Items counted in litres, kg, metres … (e.g. engine oil from a 208 L drum)

Each item is **counted in** one unit (its base unit). Most items are counted in pieces, but any unit can be used:

1. **Units** page: add the units once, e.g. *Litre (L)* and *Drum (drum)*. Leave their factors alone.
2. **Inventory → Add/Edit item**: set **Counted in** to *Litre*, tick *Drum* and enter **1 Drum = 208 L**.
3. **Receive Stock**: receive `1 Drum` → stock goes up by 208 L (the screen shows the conversion).
4. **Issue Stock**: choose *Litre* and enter `20` → stock goes down by 20 L; the screen shows what will be left (188 L). Decimals (0.5 L) are fine.

Rules: the *Counted in* unit can only be changed while the item has no stock history (the API refuses otherwise). A unit newly added to a non-piece item must have its factor entered (the API refuses it otherwise). Items counted in pieces behave exactly as before.

## Kits & tool sets

A **kit** (e.g. *80-in-1 Tool Kit*) is an item of type *Kit / Tool set* with a list of what is inside **one set** (`Flat screwdriver × 8`, `Ratchet × 1`, …). Enter the list in the item form — one line per piece, or use **Paste list** (`2 x Flat screwdriver`, `Ratchet handle`, …).

**Seeing the pieces.** On *Inventory* each kit has an arrow to expand its pieces, shown as `Flat (slotted) bit (Precision Screwdriver Set (80-in-1))` with their own *Available* / *Issued Out* counts. Searching for a piece name (e.g. "tweezers") finds it inside its kit. Each row has an issue shortcut.

**Issuing.** On *Issue Stock* pick the kit, then choose:

- **Whole kit** – N complete sets leave; one kit line plus one line for *every* piece is logged against the recipient.
- **Individual pieces** – tick just the pieces (and quantities) needed. Pieces are taken from loose stock first; if none are loose a complete set is *opened* (sets −1, its other pieces become loose pieces that are still counted).

**Returning.** On *Return Stock* the recipient list shows sets out and pieces out (including people who only borrowed a single piece). The return form has a checklist of every piece still out. If everything for the sets is back they snap back into complete sets; if something is missing the rest go to loose stock, the return is flagged *Incomplete – missing …* and the missing pieces stay outstanding against that person.

**Accounting rules**

| Quantity | Meaning |
|----------|---------|
| Kit *Available* | Complete sets in store |
| Piece *In store* | `complete sets × per-set qty + loose pieces` |
| Piece *Issued out* | Issued to recipients and not yet returned (whole-kit issues included) |

- Loose pieces can be **repacked** into complete sets from the kit's page once a full set's worth exists.
- Lost/replacement pieces can be added under *Receive Stock → Replacement pieces*.
- Contents can't be added/removed/re-quantified while sets are out (returns are checked against what was issued); names and notes can always be edited. Removing a piece that has history archives it so old records stay readable.
- A kit with **no** pieces listed behaves exactly as before (a single countable unit), so existing data keeps working. To convert one, return any outstanding sets and then add its pieces via *Edit*.
- Reports (Daily Issues, Events, Dashboard) count sets and pieces separately and never count a whole-kit issue twice.

## Inventory columns

On **Inventory**, click **Columns** to choose what the table shows:

| Column | Meaning |
|--------|---------|
| Available Qty | In stock right now |
| Issued Out | Reusable / kit items currently with recipients and not yet returned (always 0 for consumables – they are used up, not expected back) |
| Total Qty | Available + Issued Out |

The selection is stored in the browser (`localStorage`); **Reset to default** restores the original layout.

## Returning stock

**Everything out** (default tab on *Return Stock*) shows all stock currently out in one place:

- *Expected back* (reusable items and tool kits), *Consumables* (issued in the last 30 days) or *Everything*.
- *By person* or *By item*, with search over person, department, item and kit piece names.
- *Return* on a line opens the normal return form (kits open the piece checklist). *Return all* on a person books back every reusable item and kit they hold in one step (all-or-nothing); consumables are never part of it.

**Consumables can be returned.** If a pack of disposable gloves was issued and the person comes back wanting face masks instead, return the gloves (quantity, unit and a reason are recorded; the stock goes back on the shelf) and use *Issue something else to …* on the confirmation to open the Issue page with the recipient already filled in. A consumable can only be returned up to what that person was issued minus what they already returned; staff decide whether the goods are unused and fit to restock. Consumables still show *Issued Out = 0* on the inventory list.


## Profile & branding
See `CHANGELOG-profile-branding.md`. Signed-in users edit their profile from the sidebar; admins set the company name and site location under **Settings**.


## Exports

- Open **Reports & Exports** in the sidebar, or use the CSV / PDF buttons on a page.
- CSV: UTF-8 with BOM and CRLF (opens correctly in Excel), one clean header row, formulas defused (`=`, `+`, `-`, `@` prefixes), streamed from the server so the full ledger exports without a row limit. Times are in the browser's time zone.
- PDF: printable report built from the same data (first 5,000 rows; use CSV for everything).
- No database changes and no new dependencies: update by replacing the files and running `docker compose up --build -d`. Existing data, backups and the other exports are untouched.

## Faulty items

Sidebar → **Faulty Items**. Report a fault from there or from any item page (Faults panel). Each fault records what is wrong,
how many are affected, who found it, and whether the item **can still be issued**:

- *Usable with fault*: stays issuable. The fault and the "how to use it" note show on the Issue Stock screen.
- *Out of service*: flagged red everywhere; resolve it when repaired / replaced / written off.

Faults never change stock numbers or the ledger. Export (CSV or PDF, with date range, status and usability filters) from the
Faulty Items page or **Reports & Exports → Faults**.

## Categories

A category is still just text on each item (so exports, filters and SKU prefixes behave exactly as before); the **Categories**
list on top of it makes mistakes fixable:

- **Inventory → Categories** (or **Rename / manage** next to the Category field when adding / editing an item): rename a category and all of
  its items change with it. Renaming a mistyped category to the correct existing one **merges** them (you are asked to confirm).
- Add a category before any item uses it, and remove one that no item uses. A category still in use cannot be removed.
- Capitalisation and spacing are ignored when comparing (“cleaning ” = “Cleaning”), so duplicates cannot be created by accident.
- A rename never changes quantities, SKUs, last-updated dates or the ledger.

## Recipients

- On **Issue Stock** the Recipient box is a searchable drop-down of saved recipients. Choosing one offers their usual department.
- Not on the list? Just type the name: it is added to the list when the issue is confirmed (and not if the issue fails). Typing an existing
  name in different capitalisation re-uses the saved spelling.
- **Edit name** (shown under a saved recipient) fixes a misspelling or changes their usual department. A new name is also applied to that
  person's past issue / return records, so what they still have out stays together. If the corrected name is already on the list you are
  asked to **merge** the two. Changing only the department does not alter past records.
- The ledger keeps the name as text on every line, so Return Stock, outstanding balances, daily issues and exports work as before.
- The list is built from the existing ledger the first time it is opened, so no recipient has to be re-entered.
