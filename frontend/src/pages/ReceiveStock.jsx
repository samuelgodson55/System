import { useState } from 'react'
import { ArrowDownToLine, CheckCircle, History, X } from 'lucide-react'
import { useInventory } from '../context/InventoryContext'
import { useAuth } from '../context/AuthContext'
import SearchBar from '../components/SearchBar'
import UnitSelect from '../components/UnitSelect'
import { defaultUnitId, baseAbbr, fmtQty, factorFor } from '../utils/units'
import { hasComponents } from '../utils/kits'
import ReceiptHistory from '../components/ReceiptHistory'
import BulkStockForm from '../components/bulk/BulkStockForm'

const TABS = [
  { id: 'receive', label: 'Receive stock' },
  { id: 'bulk', label: 'Bulk receive' },
  { id: 'history', label: 'Receipt history' },
]

export default function ReceiveStock() {
  const { items, units, addTransaction, receiveKitPieces, convertToBase } = useInventory()
  const { user } = useAuth()
  const [search, setSearch] = useState('')
  const [selectedItem, setSelectedItem] = useState(null)
  const [form, setForm] = useState({
    unitId: '',
    unitQuantity: '',
    source: 'vendor',
    vendor: '',
    notes: '',
  })
  const [success, setSuccess] = useState(null)
  const [mode, setMode] = useState('whole') // kits: 'whole' sets | 'pieces' (replacements)
  const [pieceQty, setPieceQty] = useState({})
  const [pieceFilter, setPieceFilter] = useState('')
  const [tab, setTab] = useState('receive')
  const [historyItem, setHistoryItem] = useState(null) // item the history tab is filtered to
  const [historyKey, setHistoryKey] = useState(0) // bumped after each save so the history reloads

  const filtered = items.filter(
    (i) =>
      i.name.toLowerCase().includes(search.toLowerCase()) ||
      i.sku.toLowerCase().includes(search.toLowerCase())
  )

  const isKit = hasComponents(selectedItem)

  // "= 208 L will be added" when receiving in a bigger unit such as a drum
  let receivePreview = null
  if (selectedItem && !isKit && Number(form.unitQuantity) > 0 && form.unitId) {
    const unit = units.find((u) => u.id === form.unitId)
    if (unit && unit.id !== selectedItem.baseUnitId && factorFor(unit, selectedItem) !== 1) {
      receivePreview = `= ${fmtQty(convertToBase(Number(form.unitQuantity), form.unitId, selectedItem))} ${baseAbbr(selectedItem, units)} will be added to stock`
    }
  }

  const handleSelect = (item) => {
    setSelectedItem(item)
    setForm((f) => ({ ...f, unitId: defaultUnitId(item, units) }))
    setMode('whole')
    setPieceQty({})
    setPieceFilter('')
    setSuccess(null)
  }

  // A second click while the first request is in flight used to book the stock twice
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!selectedItem || submitting) return
    setSubmitting(true)
    try {
      await submitReceive()
    } finally {
      setSubmitting(false)
    }
  }

  const submitReceive = async () => {

    if (isKit && mode === 'pieces') {
      const lines = selectedItem.components
        .map((c) => ({ componentId: c.id, quantity: Number(pieceQty[c.id]) || 0 }))
        .filter((l) => l.quantity > 0)
      if (!lines.length) return alert('Enter a quantity for at least one piece')
      try {
        await receiveKitPieces({
          itemId: selectedItem.id,
          lines,
          source: form.source,
          vendor: form.source === 'vendor' ? form.vendor : undefined,
          notes: form.notes,
        })
      } catch (err) {
        alert(err.message || 'Failed to save')
        return
      }
      setHistoryKey((k) => k + 1)
      setSuccess({
        item: selectedItem.name,
        text: `${lines.reduce((n, l) => n + l.quantity, 0)} loose piece(s)`,
      })
      setForm({ unitId: '', unitQuantity: '', source: 'vendor', vendor: '', notes: '' })
      setSelectedItem(null)
      setSearch('')
      return
    }
    if (!form.unitQuantity) return

    const qty = Number(form.unitQuantity)
    const baseQty = convertToBase(qty, form.unitId, selectedItem)

    try {
      await addTransaction({
        itemId: selectedItem.id,
        type: 'receive',
        quantity: baseQty,
        unitId: form.unitId,
        unitQuantity: qty,
        source: form.source,
        vendor: form.source === 'vendor' ? form.vendor : undefined,
        notes: form.notes,
        performedBy: user?.name || 'Unknown',
      })
    } catch (err) {
      alert(err.message || 'Failed to save')
      return
    }

    setHistoryKey((k) => k + 1)
    setSuccess({
      item: selectedItem.name,
      qty,
      unit: units.find((u) => u.id === form.unitId)?.abbreviation,
    })
    setForm({ unitId: '', unitQuantity: '', source: 'vendor', vendor: '', notes: '' })
    setSelectedItem(null)
    setSearch('')
  }

  // "Receive again" on a history row: pick that item and pre-fill where it last came from
  const handleReceiveAgain = (item, txn) => {
    handleSelect(item)
    setForm((f) => ({
      ...f,
      source: txn.source === 'head_office' ? 'head_office' : 'vendor',
      vendor: txn.source === 'head_office' ? '' : txn.vendor || '',
    }))
    setTab('receive')
  }

  return (
    <div className={`mx-auto space-y-5 ${tab === 'bulk' ? 'max-w-4xl' : 'max-w-3xl'}`}>
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Receive Stock</h1>
        <p className="text-sm text-slate-500">
          Restock from head office or vendor – one item or a whole delivery at once – and look back at what has already been received.
        </p>
      </div>

      {success && tab !== 'bulk' && (
        <div role="status" className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-800">
          <CheckCircle className="mt-0.5 h-5 w-5 shrink-0" />
          <p className="min-w-0 flex-1 text-sm">
            Received <strong>{success.text || `${success.qty} ${success.unit}`}</strong> of{' '}
            <strong>{success.item}</strong> successfully.{' '}
            <button
              type="button"
              onClick={() => { setHistoryItem(null); setTab('history') }}
              className="font-medium underline hover:no-underline"
            >
              View history
            </button>
          </p>
          <button type="button" onClick={() => setSuccess(null)} aria-label="Dismiss" className="rounded p-1 text-emerald-600 hover:bg-emerald-100">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div role="tablist" aria-label="Receive view" className="flex gap-1 border-b border-slate-200">
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

      {tab === 'bulk' ? (
        <BulkStockForm
          mode="receive"
          onSaved={() => setHistoryKey((k) => k + 1)}
          onViewHistory={() => { setHistoryItem(null); setTab('history') }}
        />
      ) : tab === 'history' ? (
        <ReceiptHistory
          itemId={historyItem?.id || null}
          refreshKey={historyKey}
          onReceiveAgain={handleReceiveAgain}
          onClearItem={() => setHistoryItem(null)}
        />
      ) : !selectedItem ? (

        <div className="card p-5">
          <label className="mb-2 block text-sm font-medium">Select Item</label>
          <SearchBar
            value={search}
            onChange={setSearch}
            placeholder="Search by name or SKU…"
          />
          <div className="mt-3 max-h-72 overflow-y-auto divide-y divide-slate-100 rounded-lg border border-slate-200">
            {filtered.slice(0, 12).map((item) => (
              <button
                key={item.id}
                onClick={() => handleSelect(item)}
                className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-slate-50"
              >
                <div>
                  <p className="text-sm font-medium">{item.name}</p>
                  <p className="text-xs text-slate-400">{item.sku} · {item.location}</p>
                </div>
                <span className="text-sm tabular-nums text-slate-500">{fmtQty(item.quantity)} {item.itemType === 'kit' ? 'sets' : baseAbbr(item, units)}</span>
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="px-4 py-8 text-center text-sm text-slate-400">No items match</p>
            )}
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="card space-y-5 p-5">
          <div className="flex items-center justify-between rounded-lg bg-slate-50 px-4 py-3">
            <div>
              <p className="font-medium">{selectedItem.name}</p>
              <p className="text-xs text-slate-400">
                Current stock: {fmtQty(selectedItem.quantity)} {selectedItem.itemType === 'kit' ? 'complete sets' : baseAbbr(selectedItem, units)}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-4">
              <button
                type="button"
                onClick={() => { setHistoryItem(selectedItem); setTab('history') }}
                className="inline-flex items-center gap-1 text-sm text-primary-600 hover:underline"
              >
                <History className="h-3.5 w-3.5" /> History
              </button>
              <button
                type="button"
                onClick={() => setSelectedItem(null)}
                className="text-sm text-primary-600 hover:underline"
              >
                Change
              </button>
            </div>
          </div>

          {isKit && (
            <div className="grid grid-cols-2 gap-3">
              {[
                ['whole', 'Complete sets'],
                ['pieces', 'Replacement pieces'],
              ].map(([value, label]) => (
                <label
                  key={value}
                  className={`flex cursor-pointer items-center justify-center rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
                    mode === value ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <input type="radio" name="kitReceiveMode" className="sr-only" checked={mode === value} onChange={() => setMode(value)} />
                  {label}
                </label>
              ))}
            </div>
          )}

          {isKit && mode === 'pieces' ? (
            <div className="space-y-2">
              <p className="text-xs text-slate-500">
                Add individual pieces to store (e.g. a replacement for a lost bit). Loose pieces
                can be repacked into complete sets from the kit's page.
              </p>
              <SearchBar value={pieceFilter} onChange={setPieceFilter} placeholder="Filter pieces…" />
              <div className="max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
                {selectedItem.components
                  .filter((c) => c.name.toLowerCase().includes(pieceFilter.trim().toLowerCase()))
                  .map((c) => (
                    <div key={c.id} className="flex items-center justify-between gap-3 px-4 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{c.name} <span className="font-normal text-slate-400">({selectedItem.name})</span></p>
                        <p className="text-xs text-slate-400">{c.available} in store</p>
                      </div>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        placeholder="0"
                        className="input w-20 py-1.5 text-right"
                        value={pieceQty[c.id] ?? ''}
                        onChange={(e) => setPieceQty({ ...pieceQty, [c.id]: e.target.value })}
                        aria-label={`Quantity of ${c.name}`}
                      />
                    </div>
                  ))}
              </div>
            </div>
          ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">Quantity</label>
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
                item={selectedItem}
                units={units}
                value={form.unitId}
                onChange={(unitId) => setForm({ ...form, unitId })}
              />
            </div>
            {receivePreview && (
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 sm:col-span-2">
                {receivePreview}
              </p>
            )}
          </div>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium">Source</label>
            <div className="flex gap-3">
              {['vendor', 'head_office'].map((s) => (
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
                  {s === 'vendor' ? 'Vendor' : 'Head Office'}
                </label>
              ))}
            </div>
          </div>

          {form.source === 'vendor' && (
            <div>
              <label className="mb-1 block text-sm font-medium">Vendor Name</label>
              <input
                className="input"
                value={form.vendor}
                onChange={(e) => setForm({ ...form, vendor: e.target.value })}
                placeholder="e.g. Office Supplies Co."
              />
            </div>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium">Notes</label>
            <textarea
              className="input"
              rows={2}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Optional notes…"
            />
          </div>

          <button type="submit" className="btn-primary w-full" disabled={submitting}>
            <ArrowDownToLine className="h-4 w-4" /> Confirm Receipt
          </button>
        </form>
      )}

    </div>
  )
}
