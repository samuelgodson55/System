# Dropdown bounds fix

Problem: drop-down lists (categories, units, events, recipients) could grow as long as their data,
running to the bottom of the screen or being clipped inside modals.

- New `components/Select.jsx` – drop-in replacement for `<select>` (same `value` / `onChange(e)` /
  `<option>` / `required` / `disabled` API). Menu height is capped to the room on screen, opens upwards
  when there is more space above, scrolls inside itself, renders in a portal (never clipped by a modal),
  full keyboard support, and a search box appears when the list has more than 8 options.
- New `hooks/useAnchoredMenu.js` – shared positioning logic.
- `RecipientCombobox` now uses the same bounded, flipping, portal menu.
- Switched to `Select`: Category (Add/Edit item), Counted-in unit, UnitSelect (issue/receive/return/bulk),
  Inventory category filter, Exports category, Event pickers (Issue + Bulk), kit-piece pickers.
- Short fixed lists (type, status, reason…) stay native. No backend, API or database changes.
