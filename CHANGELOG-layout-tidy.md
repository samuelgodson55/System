# Layout tidy: Receive Stock + Reports & Exports (frontend only)

## Receive Stock
- Now laid out like Return Stock: same width, heading, dismissible success banner and underlined tabs.
  - **Receive stock** tab: item picker / receipt form (unchanged behaviour).
  - **Receipt history** tab: all receipts with search + paging. Optional item chip to focus on one item.
- A **History** link beside "Change" on the form opens the history for the selected item; "View history" on the
  success banner and **Receive again** on history rows jump between the tabs.

## Reports & Exports
- Report groups are tabs (with dataset counts) instead of one long scrolling page; admin-only "Full data export" is its own tab.
- Cards: separator between description and filters, column list tucked into an "Included columns (n)" disclosure,
  cards no longer stretch to match their neighbour's height. Export behaviour is unchanged.

## Files changed
- frontend/src/pages/ReceiveStock.jsx, ExportsPage.jsx
- frontend/src/components/ReceiptHistory.jsx
No backend, API or database changes since the receipt-history update.
