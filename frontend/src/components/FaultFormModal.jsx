import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Ban } from 'lucide-react'
import Modal from './Modal'
import { api } from '../utils/api'
import { useInventory } from '../context/InventoryContext'
import { hasComponents } from '../utils/kits'
import { refreshFaultSummary } from '../utils/faults'
import Select from './Select'

const empty = {
  itemId: '', componentId: '', description: '', usability: 'usable', workaround: '', quantityAffected: '1', foundWith: '',
}

/**
 * Report a new fault, or edit an existing one.
 *  - `item` pre-selects (and locks) the item, `fault` switches to edit mode.
 *  - usability "usable" = can still be issued (say how); "unusable" = out of service.
 */
export default function FaultFormModal({ open, onClose, item = null, fault = null, onSaved }) {
  const { items, getUnit } = useInventory()
  const [f, setF] = useState(empty)
  const [q, setQ] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setError('')
    setQ('')
    setSaving(false)
    if (fault) {
      setF({
        itemId: fault.itemId, componentId: fault.componentId || '', description: fault.description,
        usability: fault.usability, workaround: fault.workaround || '',
        quantityAffected: String(fault.quantityAffected), foundWith: fault.foundWith || '',
      })
    } else {
      setF({ ...empty, itemId: item?.id || '' })
    }
  }, [open, fault, item])

  const chosen = items.find((i) => i.id === f.itemId) || item
  const isKit = hasComponents(chosen)
  const unitText = !chosen ? '' : isKit ? (f.componentId ? 'pieces' : 'sets') : getUnit(chosen.baseUnitId)?.abbreviation || ''
  const locked = !!fault || !!item

  const matches = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return []
    return items
      .filter((i) => i.name.toLowerCase().includes(t) || i.sku.toLowerCase().includes(t))
      .slice(0, 8)
  }, [items, q])

  const set = (patch) => setF((p) => ({ ...p, ...patch }))

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (!f.itemId) return setError('Choose the item that is faulty')
    if (!f.description.trim()) return setError('Describe the fault')
    setSaving(true)
    try {
      const body = {
        itemId: f.itemId,
        componentId: f.componentId || null,
        description: f.description,
        usability: f.usability,
        workaround: f.workaround,
        quantityAffected: Number(f.quantityAffected || 1),
        foundWith: f.foundWith,
      }
      const saved = fault ? await api.updateFault(fault.id, body) : await api.reportFault(body)
      refreshFaultSummary()
      onSaved?.(saved)
      onClose()
    } catch (err) {
      setError(err.message || 'Could not save the fault')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={fault ? 'Edit fault' : 'Report a fault'}>
      <form onSubmit={submit} className="space-y-4">
        {error && <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Item</label>
          {chosen ? (
            <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
              <span><span className="font-medium">{chosen.name}</span> <span className="font-mono text-xs text-slate-400">{chosen.sku}</span></span>
              {!locked && (
                <button type="button" className="text-primary-600 hover:underline" onClick={() => set({ itemId: '', componentId: '' })}>Change</button>
              )}
            </div>
          ) : (
            <div className="relative">
              <input className="input" autoFocus placeholder="Search item name or SKU…" value={q} onChange={(e) => setQ(e.target.value)} />
              {matches.length > 0 && (
                <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
                  {matches.map((i) => (
                    <button type="button" key={i.id} className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50"
                      onClick={() => { set({ itemId: i.id, componentId: '' }); setQ('') }}>
                      <span>{i.name}</span><span className="font-mono text-xs text-slate-400">{i.sku}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {isKit && (
          <label className="block text-sm font-medium text-slate-700">
            Which part is faulty?
            <Select className="input mt-1" value={f.componentId} onChange={(e) => set({ componentId: e.target.value })}>
              <option value="">The whole kit / not sure</option>
              {chosen.components.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </label>
        )}

        <label className="block text-sm font-medium text-slate-700">
          What is wrong?
          <textarea className="input mt-1" rows={3} maxLength={1000} value={f.description}
            placeholder="e.g. Extension cord: socket on the end is missing"
            onChange={(e) => set({ description: e.target.value })} />
        </label>

        <div>
          <p className="mb-1 text-sm font-medium text-slate-700">Can it still be issued?</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <button type="button" onClick={() => set({ usability: 'usable' })}
              className={`rounded-lg border p-3 text-left text-sm ${f.usability === 'usable' ? 'border-amber-500 bg-amber-50 ring-1 ring-amber-400' : 'border-slate-300 hover:bg-slate-50'}`}>
              <span className="flex items-center gap-1.5 font-medium text-amber-800"><CheckCircle2 className="h-4 w-4" /> Yes, usable with the fault</span>
              <span className="mt-0.5 block text-xs text-slate-500">Stays issuable. Staff see the fault and workaround when issuing.</span>
            </button>
            <button type="button" onClick={() => set({ usability: 'unusable' })}
              className={`rounded-lg border p-3 text-left text-sm ${f.usability === 'unusable' ? 'border-red-500 bg-red-50 ring-1 ring-red-400' : 'border-slate-300 hover:bg-slate-50'}`}>
              <span className="flex items-center gap-1.5 font-medium text-red-700"><Ban className="h-4 w-4" /> No, out of service</span>
              <span className="mt-0.5 block text-xs text-slate-500">Should not be issued until repaired or replaced.</span>
            </button>
          </div>
        </div>

        {f.usability === 'usable' && (
          <label className="block text-sm font-medium text-slate-700">
            How can it still be used? <span className="font-normal text-slate-400">(shown when issuing)</span>
            <textarea className="input mt-1" rows={2} maxLength={1000} value={f.workaround}
              placeholder="e.g. Connect the bare ends directly into the socket"
              onChange={(e) => set({ workaround: e.target.value })} />
          </label>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium text-slate-700">
            How many are affected? {unitText && <span className="font-normal text-slate-400">({unitText})</span>}
            <input className="input mt-1" type="number" min="0.0001" step="any" value={f.quantityAffected}
              onChange={(e) => set({ quantityAffected: e.target.value })} />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Found with / returned by <span className="font-normal text-slate-400">(optional)</span>
            <input className="input mt-1" maxLength={200} value={f.foundWith} placeholder="Person or event"
              onChange={(e) => set({ foundWith: e.target.value })} />
          </label>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : fault ? 'Save changes' : 'Report fault'}</button>
        </div>
      </form>
    </Modal>
  )
}
