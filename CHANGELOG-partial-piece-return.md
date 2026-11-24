# Tool kits: return PART of a piece (e.g. 3 of 6 screwdriver bits)

## How to use it
Return Stock -> Everything out -> click the person's name -> click **Return** next to the piece
(e.g. "6 × Screwdriver bits") -> change the number to what actually came back (e.g. 3)
-> Confirm return. The other 3 stay recorded against that person. Repeat later for the rest
(or tap "All").

## What changed (frontend only)
- The quantity box for the clicked piece is focused and pre-selected, so typing "3" replaces the 6.
- Each piece row has − / + steppers (clamped to 0..outstanding) beside the number box and "All".
- A summary line: "Returning Screwdriver bits: 3 of 6 ... the rest stays recorded against <person>".
- Rows with a partial amount show "· 3 will stay out"; the warning names exactly what remains.
- Piece button tooltip now says "Return all or just some of this piece".

## Safety
- No backend, API, database or schema changes. The backend already supported partial piece returns
  and still refuses to return more than is out for that person.
- Each partial return is its own ledger entry; stock goes back as loose pieces and auto-repacks
  into complete sets when a full set's worth is in store.
- Edited: components/returns/KitReturnForm.jsx, components/returns/OutstandingDetailModal.jsx.
- Deploy: `docker compose up -d --build frontend`. Roll back by redeploying the previous frontend.
