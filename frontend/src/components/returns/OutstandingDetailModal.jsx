import { RotateCcw, Wrench, User, Package, Building2 } from 'lucide-react'
import Modal from '../Modal'
import StatusBadge from '../StatusBadge'
import OutstandingQuantity from './OutstandingQuantity'
import { formatDate } from '../../utils/format'
import { plural } from '../../utils/returns'

/**
 * Everything one person (or, when grouped by item, one item) has out, in full: nothing is
 * truncated, and every loose piece of a tool kit is listed by name.
 * Returning from here hands over to the normal return flow (this dialog closes first).
 */
export default function OutstandingDetailModal({ group, byItem, byDept = false, onClose, onReturn, onReturnAll }) {
  const lines = group?.lines || []
  const returnable = lines.filter((l) => l.itemType !== 'consumable')

  return (
    <Modal open={!!group} onClose={onClose} title={byItem ? 'Who has this item' : byDept ? 'Stock with this department' : 'Items issued'} size="lg">
      {group && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-50 ring-1 ring-slate-200">
                {byItem ? <Package className="h-5 w-5 text-indigo-500" /> : byDept ? <Building2 className="h-5 w-5 text-emerald-600" /> : <User className="h-5 w-5 text-slate-500" />}
              </div>
              <div className="min-w-0">
                <p className="truncate text-base font-semibold">{group.label}</p>
                <p className="truncate text-xs text-slate-500">
                  {group.sublabel ? `${group.sublabel} · ` : ''}
                  {plural(lines.length, byItem ? 'person' : 'item', byItem ? 'people' : 'items')} out
                </p>
              </div>
            </div>
            {!byItem && !byDept && returnable.length > 1 && (
              <button type="button" className="btn-secondary shrink-0" onClick={() => onReturnAll(group)}>
                <RotateCcw className="h-4 w-4" /> Return all ({returnable.length})
              </button>
            )}
          </div>

          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {lines.map((l) => {
              const kit = l.itemType === 'kit'
              return (
                <li key={`${l.itemId}-${l.recipient}-${l.department}`} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium">{byItem ? l.recipient : l.itemName}</p>
                        {!byItem && l.itemType === 'consumable' && <StatusBadge status="consumable">consumable</StatusBadge>}
                        {!byItem && kit && <Wrench className="h-3.5 w-3.5 text-indigo-500" aria-label="Tool kit" />}
                      </div>
                      <p className="text-xs text-slate-400">
                        {byItem ? l.department || 'No department' : byDept ? `${l.recipient} · ${l.sku}` : l.sku}
                        {l.lastIssuedAt ? ` · issued ${formatDate(l.lastIssuedAt)}` : ''}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <div className="text-right"><OutstandingQuantity line={l} /></div>
                      <button type="button" className="btn-secondary px-3 py-1.5" onClick={() => onReturn(l)}>
                        <RotateCcw className="h-3.5 w-3.5" /> Return
                      </button>
                    </div>
                  </div>
                  {kit && l.components.length > 0 && (
                    <ul className="mt-2 flex flex-wrap gap-1.5" aria-label={`Pieces of ${l.itemName} still out`}>
                      {l.components.map((c) => (
                        <li key={c.componentId} className="flex items-center gap-1.5 rounded-md bg-slate-50 py-0.5 pl-2 pr-0.5 text-xs text-slate-600 ring-1 ring-inset ring-slate-200">
                          <span><span className="font-medium tabular-nums">{c.outstanding} ×</span> {c.name}</span>
                          <button
                            type="button"
                            onClick={() => onReturn(l, { componentId: c.componentId })}
                            className="rounded bg-white px-1.5 py-0.5 font-medium text-primary-700 ring-1 ring-slate-200 hover:bg-primary-50"
                            aria-label={`Return ${c.name} (all or part)`}
                            title="Return all or just some of this piece"
                          >
                            Return
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>

          <div className="flex justify-end">
            <button type="button" className="btn-secondary" onClick={onClose}>Close</button>
          </div>
        </div>
      )}
    </Modal>
  )
}
