import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowUpFromLine, CheckCircle, Wrench, Package, PackageOpen, Info } from 'lucide-react'
import { useInventory } from '../context/InventoryContext'
import { useAuth } from '../context/AuthContext'
import SearchBar from '../components/SearchBar'
import StatusBadge from '../components/StatusBadge'
import UnitSelect from '../components/UnitSelect'
import IssueFaultWarning from '../components/IssueFaultWarning'
import RecipientCombobox from '../components/RecipientCombobox'
import RecipientEditModal from '../components/RecipientEditModal'
import { useRecipients } from '../hooks/useRecipients'
import { defaultUnitId, baseAbbr, fmtQty, factorFor } from '../utils/units'
import { componentLabel, hasComponents } from '../utils/kits'
import BulkStockForm from '../components/bulk/BulkStockForm'
import Select from '../components/Select'

const emptyForm = {
  unitId: '',
  unitQuantity: '',
  source: 'site',
  eventId: '',
  recipient: '',
  department: '',
  notes: '',
}

/** Complete sets that must be opened to take these pieces (mirrors the server rule). */
function setsToOpen(kit, qty) {
  let open = 0
  for (const c of kit.components) {
    const k = Number(qty[c.id]) || 0
    const short = k - c.loose
    if (k > 0 && short > 0) open = Math.max(open, Math.ceil(short / c.quantityPerKit))
  }
  return open
}

function SingleIssue() {
  const { items, units, events, addTransaction, issueKit, convertToBase } = useInventory()
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [selectedItem, setSelectedItem] = useState(null)
  const [kitMode, setKitMode] = useState('whole') // 'whole' | 'pieces'
  const [sets, setSets] = useState('1')
  const [pieceQty, setPieceQty] = useState({})
  const [pieceFilter, setPieceFilter] = useState('')
  const [form, setForm] = useState(emptyForm)
  const [success, setSuccess] = useState(null)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const { recipients, reload: reloadRecipients } = useRecipients()
  const [editingRecipient, setEditingRecipient] = useState(null)

  // department suggestions from what is already saved
  const departments = useMemo(
    () => [...new Set(recipients.map((r) => r.department).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [recipients]
  )

  // A saved recipient has ONE department. It is filled in and locked so the same person can never be
  // issued under two departments (change it via "Edit name" under the recipient).
  const savedRecipient = useMemo(() => {
    const n = form.recipient.trim().toLowerCase()
    return n ? recipients.find((r) => r.name.toLowerCase() === n) || null : null
  }, [recipients, form.recipient])
  const deptLocked = !!savedRecipient?.department
  useEffect(() => {
    if (deptLocked && form.department !== savedRecipient.department) {
      setForm((f) => ({ ...f, department: savedRecipient.department }))
    }
  }, [deptLocked, savedRecipient, form.department])

  const isKit = hasComponents(selectedItem)
  // Always read the live record so stock counts stay current after each issue
  const liveItem = selectedItem ? items.find((i) => i.id === selectedItem.id) || selectedItem : null

  const q = search.trim().toLowerCase()

  // Rows in the picker: every item, plus the matching pieces of kits when searching
  const rows = useMemo(() => {
    const out = []
    for (const item of items) {
      const itemMatch =
        !q || item.name.toLowerCase().includes(q) || item.sku.toLowerCase().includes(q)
      const pieces = q && hasComponents(item)
        ? item.components.filter((c) => c.name.toLowerCase().includes(q))
        : []
      if (itemMatch) out.push({ kind: 'item', item })
      for (const c of pieces) out.push({ kind: 'piece', item, comp: c })
    }
    return out
  }, [items, q])

  const activeEvents = events.filter((e) => e.status !== 'completed')

  const handleSelect = (item, presetComponentId = null) => {
    setSelectedItem(item)
    setForm((f) => ({
      ...f,
      unitId: defaultUnitId(item, units),
    }))
    setSuccess(null)
    setError('')
    setSets('1')
    setPieceFilter('')
    if (hasComponents(item)) {
      if (presetComponentId) {
        setKitMode('pieces')
        setPieceQty({ [presetComponentId]: '1' })
      } else {
        setKitMode('whole')
        setPieceQty({})
      }
    }
  }

  // Deep link from the Inventory page: /issue?item=ID&component=ID
  useEffect(() => {
    const itemId = params.get('item')
    if (!itemId || selectedItem) return
    const item = items.find((i) => i.id === itemId)
    if (item) {
      handleSelect(item, params.get('component'))
      setParams({}, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, params])

  // Link from Return Stock ("issue something else"): /issue?recipient=NAME&department=DEPT
  useEffect(() => {
    const recipient = params.get('recipient')
    if (!recipient) return
    setForm((f) => ({ ...f, recipient, department: params.get('department') || '' }))
    const next = new URLSearchParams(params)
    next.delete('recipient')
    next.delete('department')
    setParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])

  const reset = () => {
    setForm(emptyForm)
    setSelectedItem(null)
    setSearch('')
    setSets('1')
    setPieceQty({})
  }

  const people = {
    recipient: form.recipient,
    department: form.department,
    source: form.source,
    eventId: form.source === 'event' ? form.eventId : undefined,
    notes: form.notes,
  }

  // Returns true when the issue went through (false = validation message shown)
  const submitKit = async () => {
    const fail = (msg) => {
      setError(msg)
      return false
    }
    const kit = liveItem
    if (kitMode === 'whole') {
      const n = Number(sets)
      if (!Number.isInteger(n) || n < 1) return fail('Enter a whole number of sets')
      if (n > kit.quantity) return fail(`Only ${kit.quantity} complete set(s) in store`)
      await issueKit({ itemId: kit.id, mode: 'whole', sets: n, ...people })
      setSuccess({
        text: (
          <>
            Issued <strong>{n} {n === 1 ? 'set' : 'sets'}</strong> of <strong>{kit.name}</strong> —
            all {kit.componentPieces * n} pieces are logged against {form.recipient}.
          </>
        ),
      })
    } else {
      const lines = kit.components
        .map((c) => ({ componentId: c.id, quantity: Number(pieceQty[c.id]) || 0 }))
        .filter((l) => l.quantity > 0)
      if (!lines.length) return fail('Enter a quantity for at least one piece')
      for (const l of lines) {
        const c = kit.components.find((x) => x.id === l.componentId)
        if (!Number.isInteger(l.quantity)) return fail(`${c.name}: use a whole number`)
        if (l.quantity > c.available) {
          return fail(`Only ${c.available} × ${c.name} in store`)
        }
      }
      const res = await issueKit({ itemId: kit.id, mode: 'pieces', lines, ...people })
      const total = lines.reduce((n, l) => n + l.quantity, 0)
      setSuccess({
        text: (
          <>
            Issued <strong>{total} {total === 1 ? 'piece' : 'pieces'}</strong> from{' '}
            <strong>{kit.name}</strong>
            {res.setsOpened > 0 &&
              ` (${res.setsOpened} complete ${res.setsOpened === 1 ? 'set was' : 'sets were'} opened)`}
            .
          </>
        ),
      })
    }
    return true
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!selectedItem) return
    setSubmitting(true)
    try {
      if (isKit) {
        if (await submitKit()) {
          reset()
          reloadRecipients()
        }
        return
      }
      if (!form.unitQuantity) return
      const qty = Number(form.unitQuantity)
      const baseQty = convertToBase(qty, form.unitId, liveItem)
      if (baseQty > liveItem.quantity + 1e-6) {
        setError(`Insufficient stock. Available: ${fmtQty(liveItem.quantity)} ${baseAbbr(liveItem, units)}`)
        return
      }
      await addTransaction({
        itemId: selectedItem.id,
        type: 'issue',
        quantity: baseQty,
        unitId: form.unitId,
        unitQuantity: qty,
        ...people,
        performedBy: user?.name || 'Unknown',
      })
      setSuccess({
        text: (
          <>
            Issued{' '}
            <strong>
              {qty} {units.find((u) => u.id === form.unitId)?.abbreviation}
            </strong>{' '}
            of <strong>{selectedItem.name}</strong> successfully.
          </>
        ),
      })
      reset()
      reloadRecipients()
    } catch (err) {
      setError(err.message || 'Failed to issue')
    } finally {
      setSubmitting(false)
    }
  }

  const qtyLabel = selectedItem?.itemType === 'kit' ? 'sets' : 'units'

  // Live "what will actually leave stock" line, e.g. "= 20 L · 188 L will be left"
  let issuePreview = null
  if (liveItem && !isKit && Number(form.unitQuantity) > 0 && form.unitId) {
    const base = convertToBase(Number(form.unitQuantity), form.unitId, liveItem)
    const left = Math.round((Number(liveItem.quantity) - base) * 10000) / 10000
    const abbr = baseAbbr(liveItem, units)
    const unit = units.find((u) => u.id === form.unitId)
    const converted = unit && unit.id !== liveItem.baseUnitId && factorFor(unit, liveItem) !== 1
    issuePreview = {
      text:
        (converted ? `= ${fmtQty(base)} ${abbr} · ` : '') +
        (left >= 0 ? `${fmtQty(left)} ${abbr} will be left in store` : `Only ${fmtQty(liveItem.quantity)} ${abbr} in store`),
    }
  }

  const shownPieces = isKit
    ? liveItem.components.filter((c) => c.name.toLowerCase().includes(pieceFilter.trim().toLowerCase()))
    : []
  const piecesChosen = isKit
    ? liveItem.components.reduce((n, c) => n + (Number(pieceQty[c.id]) || 0), 0)
    : 0
  const opening = isKit && kitMode === 'pieces' ? setsToOpen(liveItem, pieceQty) : 0

  return (
    <div className="space-y-6">
      {success && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-800">
          <CheckCircle className="h-5 w-5 shrink-0" />
          <p className="text-sm">{success.text}</p>
        </div>
      )}

      {!selectedItem ? (
        <div className="card p-5">
          <label className="mb-2 block text-sm font-medium">Select Item</label>
          <SearchBar
            value={search}
            onChange={setSearch}
            placeholder="Search by name or SKU — or a piece inside a kit…"
          />
          <div className="mt-3 max-h-96 overflow-y-auto divide-y divide-slate-100 rounded-lg border border-slate-200">
            {rows.slice(0, 30).map((row) =>
              row.kind === 'item' ? (
                <button
                  key={row.item.id}
                  onClick={() => handleSelect(row.item)}
                  className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-slate-50"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium">{row.item.name}</p>
                      <StatusBadge status={row.item.itemType || 'consumable'}>
                        {row.item.itemType || 'consumable'}
                      </StatusBadge>
                      {row.item.itemType === 'kit' && row.item.piecesPerSet && (
                        <span className="inline-flex items-center gap-1 text-xs text-indigo-600">
                          <Wrench className="h-3 w-3" /> {row.item.piecesPerSet}-piece
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400">
                      {row.item.sku}
                      {hasComponents(row.item) && ' · issue whole or by piece'}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 text-sm tabular-nums ${
                      row.item.quantity <= row.item.reorderLevel ? 'text-red-500' : 'text-slate-500'
                    }`}
                  >
                    {fmtQty(row.item.quantity)} {row.item.itemType === 'kit' ? 'sets' : baseAbbr(row.item, units)}
                  </span>
                </button>
              ) : (
                <button
                  key={`${row.item.id}-${row.comp.id}`}
                  onClick={() => handleSelect(row.item, row.comp.id)}
                  className="flex w-full items-center justify-between bg-slate-50/60 py-3 pl-8 pr-4 text-left hover:bg-slate-100"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium">{componentLabel(row.comp, row.item)}</p>
                      <StatusBadge status="component">piece</StatusBadge>
                    </div>
                    <p className="text-xs text-slate-400">
                      {row.comp.quantityPerKit} per set · {row.comp.outstanding} out
                    </p>
                  </div>
                  <span className="shrink-0 text-sm tabular-nums text-slate-500">
                    {row.comp.available} pcs
                  </span>
                </button>
              )
            )}
            {rows.length === 0 && (
              <p className="px-4 py-8 text-center text-sm text-slate-400">No items match</p>
            )}
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="card space-y-5 p-5">
          <div className="flex items-center justify-between rounded-lg bg-slate-50 px-4 py-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium">{selectedItem.name}</p>
                <StatusBadge status={selectedItem.itemType || 'consumable'}>
                  {selectedItem.itemType || 'consumable'}
                </StatusBadge>
              </div>
              <p className="text-xs text-slate-400">
                Available: {fmtQty(liveItem.quantity)} {selectedItem.itemType === 'kit' ? 'complete sets' : baseAbbr(liveItem, units)}
                {isKit && liveItem.loosePieces > 0 ? ` + ${liveItem.loosePieces} loose pieces` : ''}
                {selectedItem.itemType === 'kit' && selectedItem.piecesPerSet
                  ? ` · ${selectedItem.piecesPerSet} pieces per set`
                  : ''}
              </p>
              {selectedItem.kitNotes && !isKit && (
                <p className="mt-1 text-xs text-slate-500">Contains: {selectedItem.kitNotes}</p>
              )}
            </div>
            <button type="button" onClick={reset} className="text-sm text-primary-600 hover:underline">
              Change
            </button>
          </div>

          <IssueFaultWarning itemId={selectedItem.id} />

          {error && (
            <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
          )}

          {isKit ? (
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium">What is being issued?</label>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    ['whole', 'Whole kit', 'Every piece goes out together', Package],
                    ['pieces', 'Individual pieces', 'Only the pieces you pick', PackageOpen],
                  ].map(([value, title, hint, Icon]) => (
                    <label
                      key={value}
                      className={`flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 transition-colors ${
                        kitMode === value
                          ? 'border-primary-500 bg-primary-50'
                          : 'border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <input
                        type="radio"
                        name="kitMode"
                        className="sr-only"
                        checked={kitMode === value}
                        onChange={() => {
                          setKitMode(value)
                          setError('')
                        }}
                      />
                      <Icon className="mt-0.5 h-5 w-5 shrink-0 text-primary-600" />
                      <span>
                        <span className="block text-sm font-medium">{title}</span>
                        <span className="block text-xs text-slate-500">{hint}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {kitMode === 'whole' ? (
                <div className="space-y-3">
                  <div className="sm:w-1/2">
                    <label className="mb-1 block text-sm font-medium">Number of sets</label>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      max={liveItem.quantity}
                      className="input"
                      value={sets}
                      onChange={(e) => setSets(e.target.value)}
                      required
                      autoFocus
                    />
                  </div>
                  <details className="rounded-lg border border-slate-200 text-sm">
                    <summary className="cursor-pointer px-4 py-2.5 font-medium text-slate-700">
                      Everything that goes out with it ({liveItem.componentPieces * (Number(sets) || 1)} pieces)
                    </summary>
                    <ul className="max-h-48 divide-y divide-slate-100 overflow-y-auto border-t border-slate-100 px-4">
                      {liveItem.components.map((c) => (
                        <li key={c.id} className="flex justify-between py-1.5">
                          <span>{c.name}</span>
                          <span className="tabular-nums text-slate-500">
                            × {c.quantityPerKit * (Number(sets) || 1)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </details>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <label className="text-sm font-medium">Pick the pieces</label>
                    <span className="text-xs text-slate-500">
                      {piecesChosen} {piecesChosen === 1 ? 'piece' : 'pieces'} selected
                    </span>
                  </div>
                  <SearchBar value={pieceFilter} onChange={setPieceFilter} placeholder="Filter pieces…" />
                  <div className="max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
                    {shownPieces.map((c) => {
                      const val = pieceQty[c.id] ?? ''
                      return (
                        <div
                          key={c.id}
                          className={`flex items-center justify-between gap-3 px-4 py-2 ${
                            Number(val) > 0 ? 'bg-primary-50/50' : ''
                          }`}
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">
                              {c.name}{' '}
                              <span className="font-normal text-slate-400">({selectedItem.name})</span>
                            </p>
                            <p className="text-xs text-slate-400">
                              {c.available} in store{c.outstanding > 0 ? ` · ${c.outstanding} out` : ''}
                            </p>
                          </div>
                          <input
                            type="number"
                            min="0"
                            max={c.available}
                            step="1"
                            inputMode="numeric"
                            placeholder="0"
                            disabled={c.available === 0}
                            className="input w-20 py-1.5 text-right"
                            value={val}
                            onChange={(e) => setPieceQty({ ...pieceQty, [c.id]: e.target.value })}
                            aria-label={`Quantity of ${c.name}`}
                          />
                        </div>
                      )
                    })}
                    {shownPieces.length === 0 && (
                      <p className="px-4 py-6 text-center text-sm text-slate-400">No pieces match</p>
                    )}
                  </div>
                  {opening > 0 && (
                    <p className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      This will open {opening} complete {opening === 1 ? 'set' : 'sets'}; the pieces
                      left behind stay in store as loose pieces and are still counted.
                    </p>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium">Quantity ({qtyLabel})</label>
                <input
                  type="number"
                  min="0.0001"
                  step="any"
                  className="input"
                  value={form.unitQuantity}
                  onChange={(e) => setForm({ ...form, unitQuantity: e.target.value })}
                  required
                  autoFocus
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Unit</label>
                <UnitSelect
                  item={liveItem}
                  units={units}
                  value={form.unitId}
                  onChange={(unitId) => setForm({ ...form, unitId })}
                />
              </div>
              {issuePreview && (
                <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 sm:col-span-2">
                  {issuePreview.text}
                </p>
              )}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">Recipient</label>
              <RecipientCombobox
                value={form.recipient}
                onChange={(recipient) => setForm((f) => ({ ...f, recipient }))}
                recipients={recipients}
                onPick={(r, { explicit }) =>
                  setForm((f) => ({
                    ...f,
                    // choosing from the list offers their usual department; just tabbing past a
                    // matching name never overwrites a department that is already filled in
                    department: r.department ? r.department : explicit ? '' : f.department || '',
                  }))
                }
                onEdit={user?.role === 'admin' ? setEditingRecipient : undefined}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Department</label>
              <input
                className={`input ${deptLocked ? 'bg-slate-50 text-slate-600' : ''}`}
                value={form.department}
                onChange={(e) => setForm({ ...form, department: e.target.value })}
                placeholder="e.g. IT, Maintenance"
                list="issue-departments"
                maxLength={120}
                readOnly={deptLocked}
                required
              />
              {deptLocked && (
                <p className="mt-1 text-xs text-slate-500">
                  {savedRecipient.name}’s department. To change it, use “Edit” under the recipient.
                </p>
              )}
              <datalist id="issue-departments">
                {departments.map((d) => (
                  <option key={d} value={d} />
                ))}
              </datalist>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">Purpose</label>
            <div className="flex gap-3">
              {['site', 'event'].map((s) => (
                <label
                  key={s}
                  className={`flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium transition-colors ${
                    form.source === s
                      ? 'border-primary-500 bg-primary-50 text-primary-700'
                      : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <input
                    type="radio"
                    name="source"
                    value={s}
                    checked={form.source === s}
                    onChange={() => setForm({ ...form, source: s })}
                    className="sr-only"
                  />
                  {s === 'site' ? 'Site Use' : 'Event'}
                </label>
              ))}
            </div>
          </div>

          {form.source === 'event' && (
            <div>
              <label className="mb-1 block text-sm font-medium">Event</label>
              <Select
                className="input"
                value={form.eventId}
                onChange={(e) => setForm({ ...form, eventId: e.target.value })}
                required
              >
                <option value="">Select event…</option>
                {activeEvents.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} ({e.status})
                  </option>
                ))}
              </Select>
            </div>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium">Notes</label>
            <textarea
              className="input"
              rows={2}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder={
                selectedItem.itemType === 'kit'
                  ? 'e.g. Complete set / note any missing pieces expected'
                  : 'Optional notes…'
              }
            />
          </div>

          <button type="submit" className="btn-primary w-full" disabled={submitting}>
            <ArrowUpFromLine className="h-4 w-4" />
            {submitting ? 'Issuing…' : 'Confirm Issue'}
          </button>
        </form>
      )}

      <RecipientEditModal
        recipient={editingRecipient}
        onClose={() => setEditingRecipient(null)}
        onSaved={(res, before) => {
          // keep the form pointing at the same person under their corrected name
          setForm((f) =>
            f.recipient.trim().toLowerCase() === before.name.toLowerCase()
              ? { ...f, recipient: res.recipient.name, department: f.department || res.recipient.department || '' }
              : f
          )
          reloadRecipients()
        }}
      />
    </div>
  )
}

const TABS = [
  { id: 'single', label: 'Issue stock' },
  { id: 'bulk', label: 'Bulk issue' },
]

/**
 * Issue Stock page. "Issue stock" is the original single-item flow, unchanged; "Bulk issue" books
 * many items to one recipient in a single all-or-nothing save. Both stay mounted so a half-filled
 * form is not lost when switching tabs.
 */
export default function IssueStock() {
  const [params] = useSearchParams()
  const [tab, setTab] = useState(params.get('mode') === 'bulk' ? 'bulk' : 'single')
  return (
    <div className={`mx-auto space-y-5 ${tab === 'bulk' ? 'max-w-4xl' : 'max-w-2xl'}`}>
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Issue Stock</h1>
        <p className="text-sm text-slate-500">
          Issue items to a recipient for site use or an event – one item, or a whole list at once
        </p>
      </div>

      <div role="tablist" aria-label="Issue view" className="flex gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.id ? 'border-primary-600 text-primary-700' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className={tab === 'single' ? '' : 'hidden'}>
        <SingleIssue />
      </div>
      <div className={tab === 'bulk' ? '' : 'hidden'}>
        <BulkStockForm mode="issue" />
      </div>
    </div>
  )
}
