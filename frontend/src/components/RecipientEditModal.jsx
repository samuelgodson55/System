import { useEffect, useState } from 'react'
import { api } from '../utils/api'
import Modal from './Modal'

/**
 * Edit a saved recipient: fix the spelling of the name, or change the department that is
 * offered next time. A new name also replaces the old one on past issue/return records, so
 * what the person still has out stays together under the corrected name.
 *
 * A person has ONE department. If their past records sit under more than one (or under a
 * different one than saved), this dialog shows it and, on save, files all of it under the chosen
 * department so they have a single stock history. Quantities and stock levels never change.
 */
export default function RecipientEditModal({ recipient, onClose, onSaved }) {
  const [name, setName] = useState('')
  const [department, setDepartment] = useState('')
  const [clash, setClash] = useState(null)
  const [usage, setUsage] = useState(null)
  const [applyToHistory, setApplyToHistory] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (recipient) {
      setName(recipient.name)
      setDepartment(recipient.department || '')
      setClash(null)
      setError('')
      setUsage(null)
      setApplyToHistory(true)
      let live = true
      api.getRecipientUsage(recipient.id).then((u) => live && setUsage(u)).catch(() => {})
      return () => { live = false }
    }
    return undefined
  }, [recipient])

  const save = async (merge = false) => {
    setSaving(true)
    setError('')
    try {
      const body = { name: name.trim(), department: department.trim(), merge, applyToHistory: showHistoryOption ? applyToHistory : false }
      const res = await api.updateRecipient(recipient.id, body)
      onSaved(res, recipient)
      onClose()
    } catch (e) {
      if (e.code === 'RECIPIENT_EXISTS') setClash(e.data?.existing || { name: name.trim() })
      else setError(e.message || 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  const deptNow = department.trim()
  const ledgerDepts = usage?.departments || []
  // the choice only matters when past records would change
  const differing = ledgerDepts.filter((d) => d.department.toLowerCase() !== deptNow.toLowerCase())
  const showHistoryOption = !!deptNow && differing.length > 0
  const linesAffected = differing.reduce((n, d) => n + d.lines, 0)
  const label = (d) => d || 'no department'

  const renamed = recipient && name.trim() && name.trim() !== recipient.name

  return (
    <Modal open={!!recipient} onClose={onClose} title="Edit recipient" size="sm">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          save(false)
        }}
      >
        {error && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

        {clash && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <p>
              “{clash.name}” is already on the list. Merge “{recipient.name}” into them? Their issue and
              return records are combined under “{clash.name}”.
            </p>
            <div className="mt-2 flex gap-2">
              <button type="button" className="btn-primary" disabled={saving} onClick={() => save(true)}>
                Merge
              </button>
              <button type="button" className="btn-secondary" disabled={saving} onClick={() => setClash(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}

        <div>
          <label className="mb-1 block text-sm font-medium">Name</label>
          <input
            className="input"
            value={name}
            maxLength={200}
            autoFocus
            onChange={(e) => {
              setName(e.target.value)
              setClash(null)
            }}
            required
          />
          {renamed && (
            <p className="mt-1 text-xs text-slate-500">
              Past records for “{recipient.name}” will show the new name too.
            </p>
          )}
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Usual department</label>
          <input
            className="input"
            value={department}
            maxLength={120}
            onChange={(e) => setDepartment(e.target.value)}
            placeholder="Offered automatically on the next issue"
          />
          {usage?.split && (
            <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <p className="font-medium">This person’s records are filed under more than one department:</p>
              <ul className="mt-1 list-disc pl-4">
                {ledgerDepts.map((d) => (
                  <li key={d.department || '__none__'}>
                    {label(d.department)} — {d.lines} {d.lines === 1 ? 'record' : 'records'}
                  </li>
                ))}
              </ul>
              <p className="mt-1">Pick the correct department above and save to bring everything together.</p>
            </div>
          )}
          {showHistoryOption ? (
            <label className="mt-2 flex items-start gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={applyToHistory}
                onChange={(e) => setApplyToHistory(e.target.checked)}
              />
              <span>
                Also move {linesAffected} past {linesAffected === 1 ? 'record' : 'records'} to “{deptNow}” so
                {' '}{name.trim() || 'this person'} has one stock history. Only the department label changes — no
                quantities or stock levels.
              </span>
            </label>
          ) : (
            <p className="mt-1 text-xs text-slate-500">Every new issue to this person is recorded under this department.</p>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={saving || !name.trim()}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
