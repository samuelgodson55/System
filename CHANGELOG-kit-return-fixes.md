# Kit return fixes

No database migration. No existing data is modified on deploy. API responses unchanged.
Backend only: `backend/src/services/kits.js`. Deploy: `docker compose up -d --build backend`
(roll back by redeploying the previous build).

## Fixes
- **Set no longer stays "out" after every piece is returned one by one.** Returning all of a set's
  pieces individually (per-piece Return button / pieces-only mode) left the set-level balance open,
  so the kit kept showing "1 set out" and stayed in Everything out with nothing actually out. When
  no piece behind a set is still outstanding, the set line is now closed with an audit entry
  ("Auto-closed: all pieces of this set have been returned"). Stock counts are not touched, and
  nothing is closed while any piece is still outstanding.
- **No false "Incomplete - missing" note.** "Return everything" after some pieces were already
  returned earlier no longer reports those pieces as missing (only pieces still out are listed).
  Stock maths is unchanged.

## Repairing sets already stuck (run once, after deploying)
`backend/src/db/repair-kit-sets.js` closes set balances that have no pieces behind them.
- Preview (changes nothing): `docker compose exec backend node src/db/repair-kit-sets.js`
- Apply: `docker compose exec backend node src/db/repair-kit-sets.js --apply`
- Only inserts a set-level return line per stuck balance (by "System repair", dated the day it is
  run). Never edits or deletes anything and never touches stock. Skips any set with a piece still
  out. Each kit is locked in its own transaction; safe while the app is in use; re-running finds
  nothing. Take a backup first.

## Known, not changed
- "Total sets owned" counts a loose replacement piece as part of a set (highest piece count wins),
  so lowering the total can remove a real shelf set. Intentional in the original design; review.
