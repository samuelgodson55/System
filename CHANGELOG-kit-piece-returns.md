# Tool kits: return a single piece (or a few) with full accountability

## What changed
- **Per-piece Return button** on every piece listed in the person's detail dialog (click a name in
  Return Stock -> Everything out). Opens the kit return form on just that piece.
- **Return form has two modes** (shown when complete sets are out):
  - *Whole set(s)* - as before.
  - *Specific pieces only* - sets are left untouched; nothing is ticked except the piece clicked,
    and the person enters exactly what came back (each row also has an "All" shortcut).
  When no complete set is out (only loose pieces), the form opens in pieces-only mode.
- Warning shown before saving: "N piece(s) will remain outstanding against <person>".
- Confirmation banner lists what came back and **what is still out** with that person.

## Accountability
- Each returned piece is its own ledger entry (item, piece, quantity, person, department,
  performed by, notes). Pieces not returned stay outstanding against that person and keep showing
  in Everything out, the detail dialog and exports. Nothing is auto-cleared.

## Safety
- Frontend only: backend already supported piece-only returns (sets = 0 with piece lines), and
  its validation (cannot return more than is out for that person) is unchanged.
- Edited: KitReturnForm.jsx, OutstandingDetailModal.jsx, OutstandingOverview.jsx, ReturnStock.jsx.
- Deploy: `docker compose up -d --build frontend`; roll back by redeploying the previous build.
