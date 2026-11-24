import { useEffect, useState } from 'react'
import Modal from './Modal'
import { api } from '../utils/api'
import { RESOLUTIONS, faultTarget, refreshFaultSummary } from '../utils/faults'

/** Close a fault: how it ended, plus optional notes. Does not touch stock numbers. */
export default function FaultResolveModal({ fault, onClose, onSaved }) {
  const [resolution, setResolution] = useState('repaired')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setResolution('repaired'); setNotes(''); setError(''); setSaving(false)
  }, [fault])

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const saved = await api.resolveFault(fault.id, { resolution, notes })
      refreshFaultSummary()
      onSaved?.(saved)
      onClose()
    } catch (err) {
      setError(err.message || 'Could not resolve the fault')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={!!fault} onClose={onClose} title="Resolve fault" size="sm">
      {fault && (
        <form onSubmit={submit} className="space-y-4">
          <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
            <p className="font-medium">{faultTarget(fault)}</p>
            <p className="text-slate-500">{fault.description}</p>
          </div>
          {error && <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          <label className="block text-sm font-medium text-slate-700">
            What happened?
            <select className="input mt-1" value={resolution} onChange={(e) => setResolution(e.target.value)}>
              {RESOLUTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          {resolution === 'written_off' && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              This only closes the fault. If the item is being thrown away, also lower its stock using Edit on the item page.
            </p>
          )}
          <label className="block text-sm font-medium text-slate-700">
            Notes <span className="font-normal text-slate-400">(optional)</span>
            <textarea className="input mt-1" rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Mark resolved'}</button>
          </div>
        </form>
      )}
    </Modal>
  )
}
