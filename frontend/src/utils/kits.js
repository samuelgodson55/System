// Helpers for kits / tool sets (an item with itemType 'kit' and a list of components).

/** True when the kit lists its contents (so pieces can be issued individually). */
export const hasComponents = (item) =>
  item?.itemType === 'kit' && Array.isArray(item.components) && item.components.length > 0

/** "Flat screwdriver (80-in-1 Tool Kit)" */
export const componentLabel = (component, kit) =>
  `${component.name}${kit ? ` (${kit.name})` : ''}`

/** Name to show for a ledger line: the piece (with its kit) or the plain item. */
export function txnItemLabel(txn, item) {
  const name = item?.name || 'Unknown'
  return txn.componentName ? `${txn.componentName} (${name})` : name
}

/**
 * Parse pasted text into components. Accepts lines such as
 *   "2 x Flat screwdriver" · "Flat screwdriver x2" · "Flat screwdriver, 2" · "Flat screwdriver"
 * Repeated names are merged by adding their quantities.
 */
export function parseComponentList(text) {
  const merged = new Map()
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim().replace(/^[-*•]\s+/, '')
    if (!line) continue
    let qty = 1
    let name = line
    let m
    if ((m = line.match(/^(\d+)\s*[x×*]\s*(.+)$/i))) {
      qty = Number(m[1]); name = m[2]
    } else if ((m = line.match(/^(.+?)\s*[x×*]\s*(\d+)$/i))) {
      qty = Number(m[2]); name = m[1]
    } else if ((m = line.match(/^(.+?)\s*[,;\t]\s*(\d+)$/))) {
      qty = Number(m[2]); name = m[1]
    }
    name = name.trim()
    if (!name || qty < 1) continue
    const key = name.toLowerCase()
    const prev = merged.get(key)
    merged.set(key, prev ? { ...prev, quantityPerKit: prev.quantityPerKit + qty } : { name, quantityPerKit: qty })
  }
  return [...merged.values()]
}
