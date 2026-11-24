// Helpers for the bulk issue / bulk receive screens.
import { hasComponents } from './kits'

/** Random id for one batch attempt (makes a retry or double-click safe on the server). */
export function newRequestId() {
  try {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  } catch {
    /* randomUUID only exists in secure contexts (https / localhost) */
  }
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`
}

/** Kits that list their contents have to be issued whole or by piece on the single Issue tab. */
export const bulkIssueBlocked = (item) => hasComponents(item)

let keySeq = 0
export const newLineKey = () => `l${++keySeq}`

/**
 * Parse pasted rows into { ident, qty, unit } entries.
 * Accepts "SKU, qty", "SKU, qty, unit" (comma, semicolon or tab separated – so a copy from Excel works).
 * A first row that has no number in the quantity column (a header row) is skipped.
 */
export function parseBulkText(text) {
  const rows = []
  const bad = []
  String(text || '')
    .split(/\r?\n/)
    .forEach((raw, i) => {
      const line = raw.trim()
      if (!line) return
      const parts = line.split(/[\t,;]/).map((s) => s.trim())
      const ident = parts[0]
      const qty = Number((parts[1] ?? '').replace(/\s/g, ''))
      if (!ident || parts[1] === undefined || !Number.isFinite(qty) || qty <= 0) {
        if (rows.length === 0 && bad.length === 0 && i === 0) return // header row
        bad.push({ line: i + 1, text: line })
        return
      }
      rows.push({ ident, qty, unit: parts[2] || '', line: i + 1 })
    })
  return { rows, bad }
}
