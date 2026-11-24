# Returns always reverse original issue context (FIFO)

## Problem
Returns were often recorded as SOURCE = Site even when the stock had been
issued under an event. That happened because:

1. The simple return form always sent `source: 'site'`.
2. The API wrote whatever source/eventId the client sent, with no matching
   against the original issue lines.
3. "Return everything" always hard-coded source = site.

Result: event history showed no return, item history showed the wrong SOURCE,
and outstanding-by-event stayed wrong after a corrective return.

## Fix (safe for live data)
- **Frontend** `SimpleReturnForm.jsx`: stop sending `source` on returns.
- **Backend** `services/returns.js`: added FIFO open-issue buckets and
  `resolveReturnAttribution` so each return is split across the original
  issue context(s) (oldest first). One return row per (source, event_id).
- **Backend** `POST /transactions` (type=return): always uses FIFO attribution;
  client source/eventId are ignored for returns.
- **Backend** kit returns and return-batch: same FIFO rule.

No schema changes. Stock quantities are unaffected. Existing wrong rows stay
as written; after deploy, new returns land under the correct event/site.

## Correcting the existing Sunday soap return
If a return was already booked under Site when it should have been Event:

1. Admin: delete that return transaction (stock is reduced again automatically).
2. Return the same quantity again for the same person – the new return is
   attributed to the original event issue(s) in FIFO order.
3. Then issue under Site if that was the intended destination.

## Deploy
`docker compose up -d --build` (frontend + backend).  
Rollback: redeploy the previous image pair.

## Follow-up fix: kit returns (found while testing)
`returnKit` attributed every kit return from **set-level** issues only and used just the first
slice for everything. Result: pieces issued one by one under an event (no set line) and then
returned came back as SOURCE = Site, and mixed event/site sets were all booked to one context.
Now (backend `services/kits.js` only, no schema change, no API change):
- Set lines are matched FIFO against set-level issues, each piece against that piece's own
  issues; one row per (source, event) slice.
- The "Auto-closed" set line is attributed the same way.
Verified against a real Postgres: plain/mixed/batch/delete-and-re-return/kit whole, pieces-only,
mixed event+site pieces with auto-close; stock and outstanding balances reconcile.

## Known (unchanged)
Rows written in the same transaction share a timestamp; FIFO order between *issue* lines of one
item created in that same instant is therefore arbitrary (only affects which event a later
return is credited to, never stock).
