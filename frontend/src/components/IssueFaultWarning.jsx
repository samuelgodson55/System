import { useEffect, useState } from 'react'
import { AlertTriangle, Ban } from 'lucide-react'
import { api } from '../utils/api'
import { useFaultSummary } from '../utils/faults'

/**
 * Shown on the Issue screen for the chosen item. Informational only: it never blocks an issue,
 * because "usable with fault" items are meant to go out (the workaround is shown here).
 */
export default function IssueFaultWarning({ itemId, componentId = null }) {
  const { byItem } = useFaultSummary()
  const [faults, setFaults] = useState([])
  const count = byItem[itemId]?.open || 0

  useEffect(() => {
    let live = true
    if (!itemId || !count) { setFaults([]); return undefined }
    api.getFaults({ itemId, status: 'open', limit: 50 })
      .then((r) => live && setFaults(r.faults))
      .catch(() => live && setFaults([]))
    return () => { live = false }
  }, [itemId, count])

  const list = faults.filter((f) => !componentId || !f.componentId || f.componentId === componentId)
  if (!list.length) return null
  const worst = list.some((f) => f.usability === 'unusable')
  return (
    <div role="status" className={`rounded-lg border px-4 py-3 text-sm ${worst ? 'border-red-200 bg-red-50 text-red-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
      <p className="flex items-center gap-1.5 font-medium">
        <AlertTriangle className="h-4 w-4" /> Known {list.length === 1 ? 'fault' : 'faults'} on this item
      </p>
      <ul className="mt-1.5 space-y-1.5">
        {list.map((f) => (
          <li key={f.id}>
            {f.usability === 'unusable' ? (
              <span className="mr-1 inline-flex items-center gap-1 font-medium text-red-700"><Ban className="h-3.5 w-3.5" /> Out of service ({f.quantityAffected} {f.unit}):</span>
            ) : (
              <span className="mr-1 font-medium">Usable with fault ({f.quantityAffected} {f.unit}):</span>
            )}
            {f.componentName ? `${f.componentName}: ` : ''}{f.description}
            {f.workaround && <span className="block text-xs">How to use it: {f.workaround}</span>}
          </li>
        ))}
      </ul>
      {worst && <p className="mt-2 text-xs">Make sure you do not hand out the pieces marked out of service.</p>}
    </div>
  )
}
