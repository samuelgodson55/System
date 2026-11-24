import { useState } from 'react'
import { RotateCcw, Wrench } from 'lucide-react'
import Modal from '../Modal'
import { useInventory } from '../../context/InventoryContext'
import { piecesOut, plural } from '../../utils/returns'

/**
 * Confirm returning everything one person has out. Every line is booked back in full in a
 * single request (all or nothing). Consumables are never part of it – they are returned one
 * at a time with an exact quantity.
 */
export default function ReturnAllModal({ group, onClose, onDone }) {
  const { returnBatch } = useInventory()
  const [notes, setNotes] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const lines = group ? group.lines.filter((l) => l.itemType !== 'consumable') : []
  const skippedConsumables = group ? group.lines.length - lines.length : 0

  const submit = async (e) => {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      const res = await returnBatch({
        recipient: group.label,
        department: group.sublabel || '',
        itemIds: lines.map((l) => l.itemId),
        notes,
      })
      onDone(res, group)
    } catch (e2) {
      setErr(e2.message || 'Return failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={!!group} onClose={busy ? () => {} : onClose} title="Return everything" size="md">
      {group && (
        <form onSubmit={submit} className="space-y-4">
          <div className="rounded-lg bg-slate-50 px-4 py-3 text-sm">
            <p><span className="text-slate-500">From:</span> <strong>{group.label}</strong>
              {group.sublabel ? ` · ${group.sublabel}` : ''}</p>
            <p className="mt-1 text-slate-500">
              {plural(lines.length, 'item', 'items')} will be booked back to store in full.
            </p>
          </div>

          {err && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}

          <ul className="max-h-60 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
            {lines.map((l) => (
              <li key={l.itemId} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="flex min-w-0 items-center gap-1.5">
                  {l.itemType === 'kit' && <Wrench className="h-3.5 w-3.5 shrink-0 text-indigo-500" />}
                  <span className="truncate">{l.itemName}</span>
                </span>
                <span className="shrink-0 tabular-nums font-medium text-amber-700">
                  {l.itemType === 'kit'
                    ? [l.outstanding > 0 && plural(l.outstanding, 'set', 'sets'),
                       piecesOut(l) > 0 && plural(piecesOut(l), 'piece', 'pieces')]
                        .filter(Boolean).join(' + ')
                    : `${l.outstanding} ${l.unit}`}
                </span>
              </li>
            ))}
          </ul>

          {skippedConsumables > 0 && (
            <p className="text-xs text-slate-500">
              {plural(skippedConsumables, 'consumable', 'consumables')} not included – return those
              one at a time with the exact quantity.
            </p>
          )}
          <p className="text-xs text-slate-500">
            For a kit this returns every set and piece still out. Need to flag a missing piece or a
            partial return? Cancel and use that item's own <em>Return</em> button.
          </p>

          <div>
            <label className="mb-1 block text-sm font-medium">Notes</label>
            <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes…" />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={busy || !lines.length}>
              <RotateCcw className="h-4 w-4" />
              {busy ? 'Saving…' : 'Return everything'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  )
}
