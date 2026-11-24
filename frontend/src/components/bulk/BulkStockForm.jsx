import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, ArrowDownToLine, ArrowUpFromLine, CheckCircle, ClipboardPaste, History, Plus, Trash2,
} from 'lucide-react'
import { api } from '../../utils/api'
import { useInventory } from '../../context/InventoryContext'
import { useRecipients } from '../../hooks/useRecipients'
import { useFaultSummary } from '../../utils/faults'
import { defaultUnitId, baseAbbr, fmtQty, factorFor, unitsForItem } from '../../utils/units'
import { bulkIssueBlocked, newLineKey, newRequestId, parseBulkText } from '../../utils/bulk'
import SearchBar from '../SearchBar'
import UnitSelect from '../UnitSelect'
import Modal from '../Modal'
import StatusBadge from '../StatusBadge'
import RecipientCombobox from '../RecipientCombobox'
import Select from '../Select'

const MAX_LINES = 200 // keep in step with the server (services/bulk.js)

const EMPTY_HEAD = {
  recipient: '',
  department: '',
  purpose: 'site', // issue: 'site' | 'event'
  eventId: '',
  source: 'vendor', // receive: 'vendor' | 'head_office'
  vendor: '',
  notes: '',
}

/**
 * Bulk issue / bulk receive: one form, many items, one all-or-nothing save.
 *  mode          'issue' | 'receive'
 *  onSaved(res)  called after a successful save
 *  onViewHistory (receive) opens the receipt history
 */
export default function BulkStockForm({ mode, onSaved, onViewHistory }) {
  const isIssue = mode === 'issue'
  const { items, units, events, reloadItems, convertToBase } = useInventory()
  const { byItem: faultsByItem } = useFaultSummary()
  const { recipients, reload: reloadRecipients } = useRecipients()

  const [head, setHead] = useState(EMPTY_HEAD)
  const [lines, setLines] = useState([]) // { key, itemId, unitId, qty }
  const [search, setSearch] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [lineErrors, setLineErrors] = useState({}) // line key -> server message
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [showAll, setShowAll] = useState(false) // after a review attempt, flag every incomplete line
  const [result, setResult] = useState(null)
  const requestId = useRef(newRequestId())
  const qtyRefs = useRef({})
  const [focusKey, setFocusKey] = useState(null)
  const searchRef = useRef(null)

  const itemsById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])
  const departments = useMemo(
    () => [...new Set(recipients.map((r) => r.department).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [recipients]
  )
  const activeEvents = events.filter((e) => e.status !== 'completed')
  const set = (patch) => setHead((h) => ({ ...h, ...patch }))

  // a saved recipient has ONE department: fill it in and lock it (change it via Edit recipient)
  const savedRecipient = useMemo(() => {
    const n = head.recipient.trim().toLowerCase()
    return n ? recipients.find((r) => r.name.toLowerCase() === n) || null : null
  }, [recipients, head.recipient])
  const deptLocked = isIssue && !!savedRecipient?.department
  useEffect(() => {
    if (deptLocked && head.department !== savedRecipient.department) {
      setHead((h) => ({ ...h, department: savedRecipient.department }))
    }
  }, [deptLocked, savedRecipient, head.department])

  // after adding a line, jump to its quantity box so a whole list can be typed without the mouse
  useEffect(() => {
    if (!focusKey) return
    qtyRefs.current[focusKey]?.focus()
    setFocusKey(null)
  }, [focusKey, lines])

  // a half-built batch is easy to lose by accident (reload, closing the tab)
  useEffect(() => {
    if (!lines.length || result) return undefined
    const warn = (e) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [lines.length, result])

  // ---- item picker -------------------------------------------------------------------------
  const q = search.trim().toLowerCase()
  const inList = useMemo(() => new Set(lines.map((l) => l.itemId)), [lines])
  const matches = useMemo(() => {
    if (!q) return []
    return items
      .filter((i) => i.name.toLowerCase().includes(q) || (i.sku || '').toLowerCase().includes(q))
      .slice(0, 8)
  }, [items, q])

  const blocked = (item) => isIssue && bulkIssueBlocked(item)

  const addItem = (item) => {
    if (blocked(item)) return
    const existing = lines.find((l) => l.itemId === item.id)
    if (existing) {
      setFocusKey(existing.key) // already listed: take them to its quantity instead of duplicating it
    } else {
      if (lines.length >= MAX_LINES) {
        setFormError(`A batch can hold up to ${MAX_LINES} items – save this one, then start another.`)
        return
      }
      const key = newLineKey()
      setLines((ls) => [...ls, { key, itemId: item.id, unitId: defaultUnitId(item, units), qty: '' }])
      setFocusKey(key)
    }
    setSearch('')
    setPickerOpen(false)
    setFormError('')
  }

  const onSearchKey = (e) => {
    if (e.key !== 'Enter') return
    e.preventDefault() // never submits the form
    if (!q) return
    // a scanned / typed SKU adds straight away; otherwise the first usable match
    const exact = items.find((i) => (i.sku || '').toLowerCase() === q)
    const pick = exact || matches.find((m) => !blocked(m))
    if (pick) addItem(pick)
  }

  const updateLine = (key, patch) => {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
    setLineErrors((er) => {
      if (!er[key]) return er
      const { [key]: _drop, ...rest } = er
      return rest
    })
  }
  const removeLine = (key) => {
    setLines((ls) => ls.filter((l) => l.key !== key))
    setLineErrors((er) => {
      const { [key]: _drop, ...rest } = er
      return rest
    })
  }

  // ---- per-line numbers & checks -----------------------------------------------------------
  const rows = lines.map((l) => {
    const item = itemsById.get(l.itemId)
    const qty = Number(l.qty)
    const filled = l.qty !== '' && Number.isFinite(qty)
    const base = item && filled && qty > 0 && l.unitId ? convertToBase(qty, l.unitId, item) : 0
    let problem = ''
    if (!item) problem = 'This item no longer exists'
    else if (l.qty === '') problem = 'Enter a quantity'
    else if (!(qty > 0)) problem = 'Quantity must be greater than 0'
    else if (isIssue && base > Number(item.quantity) + 1e-6) {
      problem = `Only ${fmtQty(item.quantity)} ${baseAbbr(item, units)} in store`
    }
    return { line: l, item, qty, base, problem }
  })
  const incomplete = rows.filter((r) => r.problem).length
  const unit = (id) => units.find((u) => u.id === id)

  const headProblem = () => {
    if (isIssue) {
      if (!head.recipient.trim()) return 'Choose or type the recipient'
      if (!head.department.trim()) return 'Enter the department'
      if (head.purpose === 'event' && !head.eventId) return 'Select the event'
    }
    return ''
  }

  const review = (e) => {
    e.preventDefault()
    setFormError('')
    setLineErrors({})
    if (!lines.length) return setFormError('Add at least one item')
    setShowAll(true)
    if (incomplete) return setFormError('Fix the highlighted lines first')
    const hp = headProblem()
    if (hp) return setFormError(hp)
    setConfirmOpen(true)
  }

  // ---- save --------------------------------------------------------------------------------
  const save = async () => {
    if (submitting) return
    setConfirmOpen(false)
    setSubmitting(true)
    setFormError('')
    const payload = {
      requestId: requestId.current,
      lines: lines.map((l) => ({ itemId: l.itemId, unitId: l.unitId || undefined, unitQuantity: Number(l.qty) })),
      notes: head.notes,
      ...(isIssue
        ? {
            recipient: head.recipient,
            department: head.department,
            source: head.purpose,
            eventId: head.purpose === 'event' ? head.eventId : undefined,
          }
        : { source: head.source, vendor: head.source === 'vendor' ? head.vendor : undefined }),
    }
    try {
      const res = await (isIssue ? api.bulkIssue(payload) : api.bulkReceive(payload))
      requestId.current = newRequestId()
      await reloadItems().catch(() => {}) // the save worked; a failed refresh must not look like a failed save
      reloadRecipients()
      setResult(res)
      setLines([])
      setShowAll(false)
      setHead(EMPTY_HEAD)
      onSaved?.(res)
    } catch (err) {
      const list = err.data?.lineErrors
      if (Array.isArray(list) && list.length) {
        const map = {}
        for (const le of list) {
          const l = lines[le.index]
          if (l) map[l.key] = le.message
        }
        setLineErrors(map)
        setFormError(err.message)
      } else if (!err.status) {
        // no HTTP status = the connection dropped; the batch may have been saved
        setFormError(
          'The connection dropped, so we cannot tell whether this batch was saved. Press the button again – it will not be booked twice.'
        )
      } else {
        setFormError(err.message || 'Could not save the batch')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const startAnother = () => {
    setResult(null)
    setFormError('')
    setLineErrors({})
    setTimeout(() => searchRef.current?.querySelector('input')?.focus(), 0)
  }

  // ---- paste import ------------------------------------------------------------------------
  const applyImport = (text) => {
    const { rows: parsed, bad } = parseBulkText(text)
    const bySku = new Map()
    const byName = new Map()
    for (const i of items) {
      if (i.sku) bySku.set(i.sku.trim().toLowerCase(), i)
      const n = i.name.trim().toLowerCase()
      if (!byName.has(n)) byName.set(n, i)
    }
    const report = { added: 0, merged: 0, problems: bad.map((b) => `Line ${b.line}: “${b.text}” – expected “SKU, quantity”`) }
    const next = lines.map((l) => ({ ...l }))
    for (const r of parsed) {
      const key = r.ident.toLowerCase()
      const item = bySku.get(key) || byName.get(key)
      if (!item) {
        report.problems.push(`Line ${r.line}: no item with SKU or name “${r.ident}”`)
        continue
      }
      if (blocked(item)) {
        report.problems.push(`Line ${r.line}: ${item.name} is a kit with listed contents – issue it on the single Issue tab`)
        continue
      }
      const allowed = unitsForItem(item, units)
      let unitId = defaultUnitId(item, units)
      if (r.unit) {
        const u = allowed.find((x) => [x.abbreviation, x.name].some((t) => t.toLowerCase() === r.unit.toLowerCase()))
        if (!u) {
          report.problems.push(`Line ${r.line}: ${item.name} cannot be counted in “${r.unit}” – skipped`)
          continue
        }
        unitId = u.id
      }
      const ex = next.find((l) => l.itemId === item.id)
      if (ex) {
        if (ex.unitId !== unitId) {
          report.problems.push(`Line ${r.line}: ${item.name} is already listed in a different unit – skipped`)
          continue
        }
        ex.qty = String(Math.round(((Number(ex.qty) || 0) + r.qty) * 10000) / 10000)
        report.merged++
      } else {
        if (next.length >= MAX_LINES) {
          report.problems.push(`Line ${r.line}: batch is full (${MAX_LINES} items) – skipped`)
          continue
        }
        next.push({ key: newLineKey(), itemId: item.id, unitId, qty: String(r.qty) })
        report.added++
      }
    }
    setLines(next)
    return report
  }

  // ---- finished: show what was booked ------------------------------------------------------
  if (result) {
    return (
      <div className="space-y-4">
        <div role="status" className={`rounded-lg border px-4 py-3 ${isIssue ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`}>
          <p className="flex items-center gap-2 text-sm font-medium">
            <CheckCircle className="h-5 w-5 shrink-0" />
            {result.replayed ? 'This batch had already been saved – ' : ''}
            {isIssue ? 'Issued' : 'Received'} {result.count} {result.count === 1 ? 'item' : 'items'}
            {isIssue && result.recipient ? ` to ${result.recipient}${result.department ? ` (${result.department})` : ''}` : ''}.
          </p>
        </div>
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">Item</th>
                <th className="px-4 py-2 text-right">{isIssue ? 'Issued' : 'Received'}</th>
                <th className="px-4 py-2 text-right">Now in store</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {result.lines.map((l) => {
                const it = itemsById.get(l.itemId)
                const u = unit(l.unitId)
                return (
                  <tr key={l.transactionId}>
                    <td className="px-4 py-2">
                      <span className="font-medium">{l.itemName}</span>{' '}
                      <span className="text-xs text-slate-400">{l.sku}</span>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">
                      {fmtQty(l.unitQuantity)} {u?.abbreviation || (it ? baseAbbr(it, units) : '')}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-500">
                      {fmtQty(l.newStock)} {it?.itemType === 'kit' ? 'sets' : it ? baseAbbr(it, units) : ''}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap gap-3">
          <button type="button" className="btn-primary" onClick={startAnother}>
            <Plus className="h-4 w-4" /> Start another batch
          </button>
          {!isIssue && onViewHistory && (
            <button type="button" className="btn-secondary" onClick={onViewHistory}>
              <History className="h-4 w-4" /> View receipt history
            </button>
          )}
        </div>
      </div>
    )
  }

  const Icon = isIssue ? ArrowUpFromLine : ArrowDownToLine
  const verb = isIssue ? 'Issue' : 'Receive'
  const purposeLabel = head.purpose === 'event' ? activeEvents.find((e) => e.id === head.eventId)?.name || 'an event' : 'site use'

  return (
    <>
    <form onSubmit={review} className="space-y-5" noValidate>
      {formError && (
        <div role="alert" className="flex items-start gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{formError}</span>
        </div>
      )}

      {/* who / where from */}
      <div className="card space-y-4 p-5">
        <h2 className="text-sm font-semibold text-slate-700">
          {isIssue ? 'Who is this for?' : 'Where did it come from?'}
        </h2>
        {isIssue ? (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium">Recipient</label>
                <RecipientCombobox
                  value={head.recipient}
                  onChange={(recipient) => set({ recipient })}
                  recipients={recipients}
                  required={false}
                  onPick={(r, { explicit }) =>
                    setHead((h) => ({
                      ...h,
                      department: r.department ? r.department : explicit ? '' : h.department || '',
                    }))
                  }
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Department</label>
                <input
                  className={`input ${deptLocked ? 'bg-slate-50 text-slate-600' : ''}`}
                  value={head.department}
                  onChange={(e) => set({ department: e.target.value })}
                  placeholder="e.g. IT, Maintenance"
                  list="bulk-issue-departments"
                  maxLength={120}
                  readOnly={deptLocked}
                />
                {deptLocked && (
                  <p className="mt-1 text-xs text-slate-500">
                    {savedRecipient.name}’s saved department. Change it from Issue Stock → Edit under the recipient.
                  </p>
                )}
                <datalist id="bulk-issue-departments">
                  {departments.map((d) => <option key={d} value={d} />)}
                </datalist>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Purpose</label>
              <div className="flex gap-3">
                {[['site', 'Site Use'], ['event', 'Event']].map(([v, label]) => (
                  <label
                    key={v}
                    className={`flex flex-1 cursor-pointer items-center justify-center rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors ${
                      head.purpose === v ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <input type="radio" name="bulkPurpose" className="sr-only" checked={head.purpose === v} onChange={() => set({ purpose: v })} />
                    {label}
                  </label>
                ))}
              </div>
            </div>
            {head.purpose === 'event' && (
              <div>
                <label className="mb-1 block text-sm font-medium">Event</label>
                <Select className="input" value={head.eventId} onChange={(e) => set({ eventId: e.target.value })}>
                  <option value="">Select event…</option>
                  {activeEvents.map((e) => <option key={e.id} value={e.id}>{e.name} ({e.status})</option>)}
                </Select>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="flex gap-3">
              {[['vendor', 'Vendor'], ['head_office', 'Head Office']].map(([v, label]) => (
                <label
                  key={v}
                  className={`flex flex-1 cursor-pointer items-center justify-center rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors ${
                    head.source === v ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <input type="radio" name="bulkSource" className="sr-only" checked={head.source === v} onChange={() => set({ source: v })} />
                  {label}
                </label>
              ))}
            </div>
            {head.source === 'vendor' && (
              <div>
                <label className="mb-1 block text-sm font-medium">Vendor name</label>
                <input
                  className="input"
                  value={head.vendor}
                  maxLength={200}
                  onChange={(e) => set({ vendor: e.target.value })}
                  placeholder="e.g. Office Supplies Co."
                />
              </div>
            )}
          </>
        )}
        <div>
          <label className="mb-1 block text-sm font-medium">Notes <span className="font-normal text-slate-400">(applied to every line)</span></label>
          <textarea
            className="input"
            rows={2}
            value={head.notes}
            onChange={(e) => set({ notes: e.target.value })}
            placeholder={isIssue ? 'Optional – e.g. requisition number' : 'Optional – e.g. delivery note / invoice number'}
          />
        </div>
      </div>

      {/* items */}
      <div className="card space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-700">
            Items <span className="font-normal text-slate-400">({lines.length}{lines.length ? ` of ${MAX_LINES} max` : ''})</span>
          </h2>
          <button type="button" className="btn-secondary px-3 py-1.5" onClick={() => setImportOpen(true)}>
            <ClipboardPaste className="h-4 w-4" /> Paste a list
          </button>
        </div>

        <div ref={searchRef} className="relative">
          <div onFocus={() => setPickerOpen(true)} onKeyDown={onSearchKey}>
            <SearchBar
              value={search}
              onChange={(v) => { setSearch(v); setPickerOpen(true) }}
              placeholder="Search by name or SKU, then press Enter to add…"
            />
          </div>
          {pickerOpen && q && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setPickerOpen(false)} aria-hidden="true" />
              <ul className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                {matches.length === 0 && <li className="px-4 py-3 text-sm text-slate-400">No items match</li>}
                {matches.map((i) => {
                  const off = blocked(i)
                  return (
                    <li key={i.id}>
                      <button
                        type="button"
                        disabled={off}
                        onClick={() => addItem(i)}
                        className="flex w-full items-center justify-between gap-3 px-4 py-2 text-left hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">{i.name}</span>
                          <span className="block text-xs text-slate-400">
                            {i.sku}
                            {off ? ' · kit with listed contents – use the single Issue tab' : inList.has(i.id) ? ' · already in the list' : ''}
                          </span>
                        </span>
                        <span className="shrink-0 text-sm tabular-nums text-slate-500">
                          {fmtQty(i.quantity)} {i.itemType === 'kit' ? 'sets' : baseAbbr(i, units)}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </div>

        {rows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-400">
            No items yet. Search above, or paste a list of SKUs and quantities.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {rows.map(({ line, item, problem, base }) => {
              const serverErr = lineErrors[line.key]
              const msg = serverErr || (line.qty !== '' || showAll ? problem : '')
              const faults = isIssue && item ? faultsByItem?.[item.id]?.open || 0 : 0
              const u = unit(line.unitId)
              const converted = item && u && u.id !== item.baseUnitId && factorFor(u, item) !== 1 && base > 0
              return (
                <li key={line.key} className={`grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_7rem_11rem_2.25rem] sm:items-start ${msg ? 'bg-red-50/50' : ''}`}>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-medium">{item?.name || 'Unknown item'}</p>
                      {item && item.itemType !== 'consumable' && (
                        <StatusBadge status={item.itemType}>{item.itemType}</StatusBadge>
                      )}
                      {faults > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800" title="This item has open faults – check the Faulty Items page">
                          <AlertTriangle className="h-3 w-3" /> {faults} open {faults === 1 ? 'fault' : 'faults'}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400">
                      {item?.sku} · In store: {item ? `${fmtQty(item.quantity)} ${item.itemType === 'kit' ? 'sets' : baseAbbr(item, units)}` : '–'}
                      {converted ? ` · = ${fmtQty(base)} ${baseAbbr(item, units)}` : ''}
                    </p>
                    {msg && <p role="alert" className="mt-1 text-xs font-medium text-red-600">{msg}</p>}
                  </div>
                  <input
                    ref={(el) => { qtyRefs.current[line.key] = el }}
                    type="number"
                    min="0.0001"
                    step="any"
                    inputMode="decimal"
                    className={`input text-right ${msg ? 'border-red-400' : ''}`}
                    placeholder="Qty"
                    aria-label={`Quantity of ${item?.name || 'item'}`}
                    value={line.qty}
                    onChange={(e) => updateLine(line.key, { qty: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault() // Enter = done with this line, back to the search for the next item
                        searchRef.current?.querySelector('input')?.focus()
                      }
                    }}
                  />
                  {item ? (
                    <UnitSelect
                      item={item}
                      units={units}
                      value={line.unitId}
                      onChange={(unitId) => updateLine(line.key, { unitId })}
                      aria-label={`Unit for ${item.name}`}
                    />
                  ) : <span />}
                  <button
                    type="button"
                    onClick={() => removeLine(line.key)}
                    className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                    aria-label={`Remove ${item?.name || 'line'}`}
                    title="Remove"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">
          {lines.length ? `${lines.length} ${lines.length === 1 ? 'item' : 'items'}` : ''}
          {incomplete > 0 && lines.length > 0 ? ` · ${incomplete} need attention` : ''}
        </p>
        <div className="flex gap-3">
          {lines.length > 0 && (
            <button
              type="button"
              className="btn-ghost"
              onClick={() => { setLines([]); setLineErrors({}); setFormError(''); setShowAll(false) }}
            >
              Clear list
            </button>
          )}
          <button type="submit" className="btn-primary" disabled={submitting || lines.length === 0}>
            <Icon className="h-4 w-4" />
            {submitting ? 'Saving…' : `Review ${verb.toLowerCase()}`}
          </button>
        </div>
      </div>

    </form>

    {/* review & confirm (outside the form so nothing inside can submit it) */}
      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title={`Confirm bulk ${verb.toLowerCase()}`} size="lg">
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            {isIssue ? (
              <>Issue <strong>{lines.length}</strong> {lines.length === 1 ? 'item' : 'items'} to <strong>{head.recipient.trim()}</strong> ({head.department.trim()}) for <strong>{purposeLabel}</strong>.</>
            ) : (
              <>Receive <strong>{lines.length}</strong> {lines.length === 1 ? 'item' : 'items'} from <strong>{head.source === 'vendor' ? head.vendor.trim() || 'vendor' : 'Head Office'}</strong>.</>
            )}{' '}
            Everything is saved together – if any line fails, nothing is saved.
          </p>
          <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 text-sm">
            {rows.map(({ line, item, qty, base }) => (
              <li key={line.key} className="flex items-center justify-between gap-3 px-4 py-2">
                <span className="min-w-0 truncate">{item?.name}</span>
                <span className="shrink-0 tabular-nums">
                  <strong>{fmtQty(qty)}</strong> {unit(line.unitId)?.abbreviation}
                  {item && line.unitId !== item.baseUnitId && factorFor(unit(line.unitId) || {}, item) !== 1 && base > 0 && (
                    <span className="text-slate-400"> (= {fmtQty(base)} {baseAbbr(item, units)})</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex justify-end gap-3">
            <button type="button" className="btn-secondary" onClick={() => setConfirmOpen(false)}>Back</button>
            <button type="button" className="btn-primary" onClick={save} disabled={submitting} autoFocus>
              <Icon className="h-4 w-4" /> Confirm {verb.toLowerCase()}
            </button>
          </div>
        </div>
      </Modal>

      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} onApply={applyImport} isIssue={isIssue} />
    </>
  )
}

function ImportModal({ open, onClose, onApply, isIssue }) {
  const [text, setText] = useState('')
  const [report, setReport] = useState(null)

  const close = () => {
    setText('')
    setReport(null)
    onClose()
  }

  return (
    <Modal open={open} onClose={close} title="Paste a list" size="lg">
      <div className="space-y-4">
        {!report ? (
          <>
            <p className="text-sm text-slate-600">
              One item per line: <code className="rounded bg-slate-100 px-1">SKU, quantity</code> or{' '}
              <code className="rounded bg-slate-100 px-1">SKU, quantity, unit</code> (e.g. <code className="rounded bg-slate-100 px-1">PEN-01, 5, carton</code>).
              Item names work too, and you can paste straight from Excel. Without a unit, the item’s base unit is used.
              {isIssue ? ' Nothing is issued until you review and confirm.' : ' Nothing is received until you review and confirm.'}
            </p>
            <textarea
              className="input font-mono"
              rows={9}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={'PEN-01, 5\nA4-PAPER, 10, ream'}
              autoFocus
            />
            <div className="flex justify-end gap-3">
              <button type="button" className="btn-secondary" onClick={close}>Cancel</button>
              <button type="button" className="btn-primary" disabled={!text.trim()} onClick={() => setReport(onApply(text))}>
                Add to list
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="flex items-center gap-2 text-sm font-medium text-emerald-700">
              <CheckCircle className="h-4 w-4" />
              Added {report.added} {report.added === 1 ? 'item' : 'items'}
              {report.merged > 0 ? `, updated ${report.merged} already in the list` : ''}.
            </p>
            {report.problems.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <p className="mb-1 font-medium">{report.problems.length} {report.problems.length === 1 ? 'row was' : 'rows were'} skipped</p>
                <ul className="max-h-48 list-disc space-y-0.5 overflow-y-auto pl-5 text-xs">
                  {report.problems.map((p, i) => <li key={i}>{p}</li>)}
                </ul>
              </div>
            )}
            <div className="flex justify-end">
              <button type="button" className="btn-primary" onClick={close}>
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
