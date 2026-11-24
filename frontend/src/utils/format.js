import { format, parseISO } from 'date-fns'

export function formatDate(dateStr) {
  if (!dateStr) return '—'
  try {
    return format(parseISO(dateStr), 'MMM d, yyyy')
  } catch {
    return dateStr
  }
}

export function formatDateTime(dateStr) {
  if (!dateStr) return '—'
  try {
    return format(parseISO(dateStr), 'MMM d, yyyy HH:mm')
  } catch {
    return dateStr
  }
}

export function formatQuantity(qty, unitAbbr) {
  if (qty == null) return '—'
  const formatted = Number.isInteger(qty) ? qty : qty.toFixed(2)
  return unitAbbr ? `${formatted} ${unitAbbr}` : String(formatted)
}
