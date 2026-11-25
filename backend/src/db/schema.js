/**
 * The database schema, as ONE idempotent script: safe to run on an empty database, on an existing one,
 * and again on every start. It only ever adds or widens things.
 *
 * It is a module (not just a script) so the backup RESTORE can run it again afterwards: a backup taken
 * before a newer feature existed would otherwise bring the old table shapes back until the next restart.
 */

// Serialises concurrent runs (e.g. two containers starting together): the lock is released when the
// script's implicit transaction ends.
const LOCK = 'SELECT pg_advisory_xact_lock(727274);\n'

export const SQL = LOCK + `
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username VARCHAR(50) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name VARCHAR(120) NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'staff' CHECK (role IN ('admin', 'staff')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Account security (additive; existing accounts keep working exactly as before):
--  * must_change_password: set when an admin creates an account or resets a password with a temporary one
--  * token_version: bumped to sign an account out everywhere (password reset / recovery / role change)
--  * recovery_codes: one-time admin recovery codes, stored ONLY as bcrypt hashes: [{ "h": "...", "used": null | ISO time }]
-- They live on the users row on purpose: a backup from before this feature restores cleanly (no extra
-- table to block the restore) and applySchema() simply re-adds the columns afterwards.
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS recovery_codes JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE users ADD COLUMN IF NOT EXISTS recovery_codes_generated_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(80) NOT NULL,
  abbreviation VARCHAR(20) NOT NULL,
  conversion_factor NUMERIC(12,4) NOT NULL DEFAULT 1,
  is_base BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200) NOT NULL,
  description TEXT,
  location VARCHAR(200),
  start_date DATE,
  end_date DATE,
  status VARCHAR(20) NOT NULL DEFAULT 'upcoming'
    CHECK (status IN ('upcoming', 'active', 'completed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  category VARCHAR(100),
  quantity NUMERIC(14,4) NOT NULL DEFAULT 0,
  base_unit_id UUID REFERENCES units(id),
  reorder_level NUMERIC(14,4) NOT NULL DEFAULT 0,
  location VARCHAR(100),
  item_type VARCHAR(20) NOT NULL DEFAULT 'consumable'
    CHECK (item_type IN ('consumable', 'reusable', 'kit')),
  pieces_per_set INTEGER,
  kit_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Safe alters for existing DBs
DO $$ BEGIN
  ALTER TABLE items ADD COLUMN IF NOT EXISTS pieces_per_set INTEGER;
  ALTER TABLE items ADD COLUMN IF NOT EXISTS kit_notes TEXT;
EXCEPTION WHEN others THEN NULL;
END $$;

-- Make sure the item_type check allows 'kit'. Only rebuilt when it is missing or an older definition
-- (it used to be dropped and re-added on every start, which takes a table lock for nothing).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'items_item_type_check' AND conrelid = 'items'::regclass
      AND pg_get_constraintdef(oid) LIKE '%kit%'
  ) THEN
    ALTER TABLE items DROP CONSTRAINT IF EXISTS items_item_type_check;
    ALTER TABLE items ADD CONSTRAINT items_item_type_check
      CHECK (item_type IN ('consumable', 'reusable', 'kit'));
  END IF;
EXCEPTION WHEN others THEN NULL;
END $$;

-- What is inside ONE set of a kit (e.g. 80-in-1: 2 x Flat screwdriver, 1 x Ratchet ...).
-- loose_quantity = pieces in store that are not inside a complete set.
CREATE TABLE IF NOT EXISTS kit_components (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kit_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  quantity_per_kit INTEGER NOT NULL DEFAULT 1 CHECK (quantity_per_kit > 0),
  loose_quantity INTEGER NOT NULL DEFAULT 0 CHECK (loose_quantity >= 0),
  notes TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_kit_components_name
  ON kit_components (kit_id, lower(name)) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_kit_components_kit ON kit_components(kit_id);

CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  type VARCHAR(20) NOT NULL CHECK (type IN ('receive', 'issue', 'return')),
  quantity NUMERIC(14,4) NOT NULL,
  unit_id UUID REFERENCES units(id),
  unit_quantity NUMERIC(14,4) NOT NULL,
  source VARCHAR(30),
  event_id UUID REFERENCES events(id) ON DELETE SET NULL,
  vendor VARCHAR(200),
  recipient VARCHAR(200),
  department VARCHAR(120),
  notes TEXT,
  performed_by VARCHAR(120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Kit tracing: a line may concern one component of a kit, and component lines made by a
-- whole-kit issue/return point at the kit-level line.
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS component_id UUID REFERENCES kit_components(id) ON DELETE CASCADE;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS parent_txn_id UUID REFERENCES transactions(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_transactions_component ON transactions(component_id);
CREATE INDEX IF NOT EXISTS idx_transactions_parent ON transactions(parent_txn_id);

CREATE INDEX IF NOT EXISTS idx_transactions_item ON transactions(item_id);
CREATE INDEX IF NOT EXISTS idx_transactions_event ON transactions(event_id);
CREATE INDEX IF NOT EXISTS idx_transactions_created ON transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_transactions_recipient ON transactions(recipient);
CREATE INDEX IF NOT EXISTS idx_items_sku ON items(sku);
CREATE INDEX IF NOT EXISTS idx_items_category ON items(category);

-- Units of measurement an item may be received / issued / returned in (base unit is
-- always allowed). Created once; existing items are backfilled with their base unit plus
-- every unit they were already used with, so nothing that works today stops working.
-- Admins can then trim the list per item. The guard keeps a restart from re-adding units
-- that were deliberately removed.
DO $$ BEGIN
  IF to_regclass('public.item_units') IS NULL THEN
    CREATE TABLE item_units (
      item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      unit_id UUID NOT NULL REFERENCES units(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (item_id, unit_id)
    );
    CREATE INDEX idx_item_units_unit ON item_units(unit_id);

    INSERT INTO item_units (item_id, unit_id)
      SELECT id, base_unit_id FROM items WHERE base_unit_id IS NOT NULL
      UNION
      SELECT item_id, unit_id FROM transactions WHERE unit_id IS NOT NULL
      ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- Per-item conversion: how many base units ONE of this unit is for THIS item (a box of pens
-- is not a box of screws). NULL = use the unit's default factor.
ALTER TABLE item_units ADD COLUMN IF NOT EXISTS conversion_factor NUMERIC(12,4)
  CHECK (conversion_factor IS NULL OR conversion_factor > 0);

-- Exact inverse of a per-item factor: how many of this unit make ONE of the item's base unit
-- (a pack-counted tissue item: Piece = 48, meaning 1 piece = 1/48 pack exactly). NULL = the unit
-- is converted with conversion_factor as before. Purely additive: nothing is rewritten.
ALTER TABLE item_units ADD COLUMN IF NOT EXISTS units_per_base NUMERIC(14,4)
  CHECK (units_per_base IS NULL OR units_per_base > 0);

-- Stock and ledger quantities (and per-item factors) were NUMERIC(.,4). A fraction such as
-- 1 piece = 1/48 pack (0.0208333...) cannot live in 4 decimals: it became 0.0208, so 6 packs
-- showed as 288.46 pieces and 48 pieces issued did not equal 1 pack. Widen them to 10 decimals.
-- Existing values are kept as they are (4-decimal numbers are valid 10-decimal numbers); a column
-- that is already wide enough is skipped, so a restart does nothing.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('items', 'quantity'),
      ('transactions', 'quantity'),
      ('item_units', 'conversion_factor')
    ) AS t(tbl, col)
  LOOP
    IF COALESCE((
         SELECT numeric_scale FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = r.tbl AND column_name = r.col
       ), 10) < 10 THEN
      EXECUTE format('ALTER TABLE %I ALTER COLUMN %I TYPE NUMERIC(22,10)', r.tbl, r.col);
    END IF;
  END LOOP;
END $$;

-- Only one base unit may exist (stock is stored in it). Skipped, not failed, if an old
-- database already holds several; the API refuses to create more either way.
DO $$ BEGIN
  CREATE UNIQUE INDEX IF NOT EXISTS uq_units_single_base ON units (is_base) WHERE is_base;
EXCEPTION WHEN others THEN NULL;
END $$;

-- Speeds up outstanding-balance maths and per-item history as the ledger grows
CREATE INDEX IF NOT EXISTS idx_transactions_item_recipient ON transactions(item_id, recipient, department);
CREATE INDEX IF NOT EXISTS idx_transactions_created_desc ON transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_items_name ON items(name);

-- Company branding (name + site location). Key/value so more settings can be added later
-- without another migration. Nothing is inserted: the app falls back to its old titles until
-- an admin sets a name, so existing installs look exactly as before after the update.
CREATE TABLE IF NOT EXISTS app_settings (
  key VARCHAR(60) PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Faulty-item register. Purely additive: it never changes stock numbers or the ledger.
-- usability: 'usable' = still fit to issue (with the workaround noted), 'unusable' = out of service.
-- quantity_affected is in the item's base unit (sets for kits, pieces for a kit piece).
CREATE TABLE IF NOT EXISTS item_faults (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  component_id UUID REFERENCES kit_components(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  usability VARCHAR(20) NOT NULL DEFAULT 'usable' CHECK (usability IN ('usable', 'unusable')),
  workaround TEXT,
  quantity_affected NUMERIC(14,4) NOT NULL DEFAULT 1 CHECK (quantity_affected > 0),
  found_with VARCHAR(200),
  status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  reported_by VARCHAR(120),
  reported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolution VARCHAR(30) CHECK (resolution IS NULL OR resolution IN ('repaired', 'replaced', 'written_off', 'no_fault')),
  resolution_notes TEXT,
  resolved_by VARCHAR(120),
  resolved_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_item_faults_item ON item_faults(item_id);
CREATE INDEX IF NOT EXISTS idx_item_faults_status ON item_faults(status, reported_at DESC);

-- Categories as real, editable records (rename / merge / remove-when-empty).
-- items.category stays plain text so every existing query, export and SKU rule keeps working;
-- this table only adds a stable list (including categories with no items yet). It starts empty
-- and is filled from the items on first use, so this statement changes no existing data.
CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_categories_name ON categories (lower(name));

-- Reusable recipients (people stock is issued to). transactions.recipient / department stay as
-- text on every ledger line (so balances, returns and exports are untouched); this table is the
-- pick-list. It is filled from the existing ledger on first use. department = default for the
-- next issue only.
CREATE TABLE IF NOT EXISTS recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200) NOT NULL,
  department VARCHAR(120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_recipients_name ON recipients (lower(name));
-- Audit trail for recipient corrections (e.g. a department fixed across a person's history).
-- Additive only: nothing reads this table except the recipient screens.
CREATE TABLE IF NOT EXISTS recipient_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id UUID,
  recipient_name VARCHAR(200) NOT NULL,
  action VARCHAR(40) NOT NULL,
  old_department VARCHAR(120),
  new_department VARCHAR(120),
  old_name VARCHAR(200),
  ledger_lines_updated INTEGER NOT NULL DEFAULT 0,
  performed_by VARCHAR(200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_recipient_audit_recipient ON recipient_audit (recipient_id, created_at DESC);

-- ---- integrity & speed (additive; nothing existing is rewritten) ----------------------------------
-- Stock can never be negative. Added only when no row breaks it today, so an install that already holds
-- a bad number keeps starting (it is skipped, not failed) and can be fixed first.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'items_quantity_nonneg' AND conrelid = 'items'::regclass)
     AND NOT EXISTS (SELECT 1 FROM items WHERE quantity < 0) THEN
    ALTER TABLE items ADD CONSTRAINT items_quantity_nonneg CHECK (quantity >= 0);
  END IF;
EXCEPTION WHEN others THEN NULL;
END $$;

-- Recipient look-ups compare lower(btrim(recipient)); without a matching index they scan the whole ledger.
CREATE INDEX IF NOT EXISTS idx_transactions_recipient_norm ON transactions (lower(btrim(recipient)));
CREATE INDEX IF NOT EXISTS idx_events_start ON events (start_date);

-- ---- multiple sites (stores / locations) -----------------------------------------------------------
-- One company, several sites. Each ITEM belongs to exactly one site, so stock, kit contents, ledger lines
-- (through their item), faults and outstanding balances are separated per site without touching any of the
-- existing stock maths. Events belong to a site too. Staff accounts are tied to one site; admins choose.
-- Categories, units and recipients stay company-wide. Everything here is additive and idempotent:
-- on an existing install ALL current data lands in one default site, so nothing changes for anybody.
CREATE TABLE IF NOT EXISTS sites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(120) NOT NULL,
  address VARCHAR(200),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sites_name ON sites (lower(name));

-- The default site: named after the old "Site location" branding setting when there is one.
INSERT INTO sites (name)
SELECT COALESCE(
  NULLIF(left(btrim((SELECT value FROM app_settings WHERE key = 'site_location')), 120), ''),
  'Main Site'
)
WHERE NOT EXISTS (SELECT 1 FROM sites);

ALTER TABLE users ADD COLUMN IF NOT EXISTS site_id UUID REFERENCES sites(id) ON DELETE RESTRICT;
ALTER TABLE items ADD COLUMN IF NOT EXISTS site_id UUID REFERENCES sites(id) ON DELETE RESTRICT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS site_id UUID REFERENCES sites(id) ON DELETE RESTRICT;

-- Backfill: everything that exists today belongs to the first (default) site. Staff are assigned to it too;
-- admins stay unassigned (they pick the site they are working in).
UPDATE items SET site_id = (SELECT id FROM sites ORDER BY created_at, id LIMIT 1) WHERE site_id IS NULL;
UPDATE events SET site_id = (SELECT id FROM sites ORDER BY created_at, id LIMIT 1) WHERE site_id IS NULL;
UPDATE users SET site_id = (SELECT id FROM sites ORDER BY created_at, id LIMIT 1) WHERE site_id IS NULL AND role = 'staff';

-- A SKU is now unique PER SITE (the same product can be stocked at several sites under the same code).
-- The new index is created before the old global constraint is dropped, inside the same transaction.
CREATE UNIQUE INDEX IF NOT EXISTS uq_items_site_sku ON items (site_id, sku);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'items_sku_key' AND conrelid = 'items'::regclass) THEN
    ALTER TABLE items DROP CONSTRAINT items_sku_key;
  END IF;
END $$;

-- Every item and event must have a site (guarded: only once nothing is left without one).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM items WHERE site_id IS NULL) THEN
    ALTER TABLE items ALTER COLUMN site_id SET NOT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM events WHERE site_id IS NULL) THEN
    ALTER TABLE events ALTER COLUMN site_id SET NOT NULL;
  END IF;
EXCEPTION WHEN others THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_items_site ON items (site_id);
CREATE INDEX IF NOT EXISTS idx_items_site_name ON items (site_id, name);
CREATE INDEX IF NOT EXISTS idx_events_site ON events (site_id);
CREATE INDEX IF NOT EXISTS idx_users_site ON users (site_id);
`

/** Apply the schema using a pg client or pool. */
export async function applySchema(db) {
  await db.query(SQL)
}
