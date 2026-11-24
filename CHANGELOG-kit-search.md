# Update: kit search on the Inventory page

- Typing a kit's name now lists that kit **collapsed** instead of dumping every piece inside it. Expand it with the arrow as before.
- If a kit is listed only because one of its **pieces** matches, it opens and shows **just the matching piece(s)** (highlighted), not the whole kit.
- Kits that match directly (name, SKU, category, location) are listed before kits that matched only through a piece.
- Multi-word search: every word must match ("precision 80" finds "Precision Screwdriver Set (80-in-1)"), in any order.
- Front-end only (`frontend/src/pages/InventoryList.jsx`). No database or API change; just rebuild the frontend image.
