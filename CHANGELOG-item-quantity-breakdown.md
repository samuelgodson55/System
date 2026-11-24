# Item page: clear "Available" vs "Total" (non-kit items)

- The first card on the item page was labelled just "Quantity" (it is the available stock). It is now
  **Available in store**, with a line under it: "N owned in total · N out with people" - the same
  breakdown the kit page shows, and consistent with Available / Total Qty on the Inventory list.
- Frontend only (pages/ItemDetail.jsx). Kits unchanged. No API, database or data changes.
- Uses `totalQuantity` and `outstanding`, which the API already returns.
- Deploy: `docker compose up -d --build frontend`; roll back by redeploying the previous frontend.
