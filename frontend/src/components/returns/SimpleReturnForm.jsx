import { useState } from 'react'
import { RotateCcw, Info } from 'lucide-react'
import { useInventory } from '../../context/InventoryContext'
import { useAuth } from '../../context/AuthContext'
import UnitSelect from '../UnitSelect'
import { defaultUnitId } from '../../utils/units'
import { CONSUMABLE_REASONS, baseUnitLabel, joinNotes } from '../../utils/returns'
import { formatDate } from '../../utils/format'

/**
 * Return form for a plain item (reusable or consumable): how much comes back, in which unit.
 * Consumables also ask why, because they are normally used up – the typical case is the wrong
 * item having been issued (gloves handed out, face masks wanted instead).
 */
export default function SimpleReturnForm({ item, balance, onCancel, onDone }) {
  const { units, addTransaction, convertToBase, unitFactor } = useInventory()
  const { user } = useAuth()
  const isConsumable = item.itemType === 'consumable'
  const unitName = baseUnitLabel(item, units)

  const [unitId, setUnitId] = useState(defaultUnitId(item, units))
  // Reusables usually come back in full, so start there. Consumables start empty so the
  // quantity is always a deliberate entry.
  const [qty, setQty] = useState(isConsumable ? '' : String(balance.outstanding))
  const [reason, setReason] = useState(isConsumable ? CONSUMABLE_REASONS[0] : '')
  const [notes, setNotes] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const factor = (unitId && unitFactor(unitId, item)) || 1
  const maxInUnit = Math.floor((balance.outstanding / factor + 1e-6) * 10000) / 10000
  const unitAbbr = units.find((u) => u.id === unitId)?.abbreviation

  // A whole number of the chosen unit may not cover the balance exactly (88 pcs in 12-packs),
  // in which case fall back to the base unit.
  const returnAll = () => {
    const inUnit = balance.outstanding / factor
    if (factor === 1 || Math.abs(inUnit - Math.round(inUnit)) < 1e-6) {
      setQty(String(factor === 1 ? balance.outstanding : Math.round(inUnit)))
    } else {
      setUnitId(item.baseUnitId || defaultUnitId(item, units))
      setQty(String(balance.outstanding))
    }
  }

  const submit = async (e) => {
    e.preventDefault()
    setErr('')
    const n = Number(qty)
    const baseQty = convertToBase(n, unitId, item)
    if (!(n > 0) || !(baseQty > 0)) return setErr('Quantity must be greater than 0')
    if (baseQty > balance.outstanding + 1e-6) {
      return setErr(`Max returnable is ${balance.outstanding} ${unitName} (${maxInUnit}${unitAbbr ? ` ${unitAbbr}` : ''} in the selected unit)`)
    }
    setBusy(true)
    try {
      // Do not send source/eventId – the server attributes the return to the
      // original issue context(s) via FIFO so event history and SOURCE stay correct.
      await addTransaction({
        itemId: item.id,
        type: 'return',
        quantity: baseQty,
        unitId,
        unitQuantity: n,
        recipient: balance.recipient,
        department: balance.department || '',
        notes: joinNotes(isConsumable ? `Reason: ${reason}` : '', notes),
        performedBy: user?.name || 'Unknown',
      })
      onDone({ qty: n, unit: unitAbbr || unitName, consumable: isConsumable })
    } catch (e2) {
      setErr(e2.message || 'Return failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="rounded-lg bg-slate-50 px-4 py-3 text-sm">
        <p><span className="text-slate-500">Item:</span> <strong>{item.name}</strong></p>
        <p className="mt-1">
          <span className="text-slate-500">From:</span> <strong>{balance.recipient}</strong>
          {balance.department ? ` · ${balance.department}` : ''}
        </p>
        <p className="mt-1">
          <span className="text-slate-500">{isConsumable ? 'Issued (not yet returned):' : 'Outstanding:'}</span>{' '}
          <strong className="text-amber-700">{balance.outstanding} {unitName}</strong>
          {isConsumable && balance.lastIssuedAt && (
            <span className="text-xs text-slate-400"> · last issued {formatDate(balance.lastIssuedAt)}</span>
          )}
        </p>
      </div>

      {isConsumable && (
        <p className="flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Only take back items that are unused and fit to go back on the shelf. They are added
            to stock again, and the return is recorded against {balance.recipient}.
          </span>
        </p>
      )}

      {err && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>}

      <div>
        <label className="mb-1 block text-sm font-medium">
          Quantity returning{unitAbbr ? ` (${unitAbbr})` : ''}
        </label>
        <input
          type="number"
          min="0.0001"
          max={maxInUnit}
          step="any"
          className="input"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          placeholder={`Max ${maxInUnit}`}
          required
          autoFocus
        />
        <button type="button" className="mt-1.5 text-xs text-primary-600 hover:underline" onClick={returnAll}>
          Return all ({balance.outstanding} {unitName})
        </button>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">Unit</label>
        <UnitSelect item={item} units={units} value={unitId} onChange={setUnitId} />
      </div>

      {isConsumable && (
        <div>
          <label className="mb-1 block text-sm font-medium">Reason</label>
          <select className="input" value={reason} onChange={(e) => setReason(e.target.value)}>
            {CONSUMABLE_REASONS.map((r) => <option key={r}>{r}</option>)}
          </select>
        </div>
      )}

      <div>
        <label className="mb-1 block text-sm font-medium">Notes</label>
        <textarea
          className="input"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={isConsumable ? 'e.g. Wanted face masks instead' : 'Optional notes…'}
        />
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <button type="button" className="btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn-primary" disabled={busy}>
          <RotateCcw className="h-4 w-4" />
          {busy ? 'Saving…' : 'Confirm return'}
        </button>
      </div>
    </form>
  )
}
