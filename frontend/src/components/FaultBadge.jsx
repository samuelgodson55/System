import { Link } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'
import { useFaultSummary } from '../utils/faults'

/** Small "n faults" pill for an item; nothing when it has none. Amber = usable, red = something is out of service. */
export default function FaultBadge({ itemId, link = true }) {
  const { byItem } = useFaultSummary()
  const s = byItem[itemId]
  if (!s || !s.open) return null
  const bad = s.unusable > 0
  const pill = (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${bad ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'}`}
      title={bad ? `${s.unusable} out of service, ${s.usable} usable with fault` : `${s.usable} usable with fault`}
    >
      <AlertTriangle className="h-3 w-3" /> {s.open} {s.open === 1 ? 'fault' : 'faults'}
    </span>
  )
  return link ? <Link to={`/inventory/${itemId}#faults`}>{pill}</Link> : pill
}
