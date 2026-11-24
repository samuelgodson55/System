import { useEffect, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {
  ArrowLeft,
  Trash2,
  Pencil,
  ArrowDownToLine,
  ArrowUpFromLine,
  RotateCcw,
  Download,
  FileText,
  Boxes,
  PackageCheck,
} from 'lucide-react'
import { useInventory } from '../context/InventoryContext'
import { api } from '../utils/api'
import StatusBadge from '../components/StatusBadge'
import { formatDateTime } from '../utils/format'
import { exportToCSV, exportToPDF, filterByDateRange } from '../utils/export'
import { transactionsOverview } from '../utils/exportSummary'
import ExportDialog from '../components/ExportDialog'
import ItemFormModal from '../components/ItemFormModal'
import { hasComponents } from '../utils/kits'
import { unitsForItem, baseAbbr, fmtQty, stockBreakdown } from '../utils/units'
import ItemFaultsPanel from '../components/ItemFaultsPanel'
import FaultBadge from '../components/FaultBadge'
import Select from '../components/Select'

export default function ItemDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const { items, getUnit, unitFactor, events, deleteItem, units, repackKit } = useInventory()
  const [exportFmt, setExportFmt] = useState(null) // 'csv' | 'pdf' | null
  const [pieceFilter, setPieceFilter] = useState('all') // history filter for kits
  const [repackError, setRepackError] = useState('')
  const [repacking, setRepacking] = useState(false)
  const [editOpen, setEditOpen] = useState(false)

  const item = items.find((i) => i.id === id)
  // History is fetched for this item only (latest 2,000 lines) instead of living in memory
  const [allTxns, setAllTxns] = useState([])
  // Anything that changes what is in store (sets, loose pieces, pieces out) must reload the history
  const stamp = `${item?.updatedAt || ''}:${item?.quantity ?? ''}:${item?.loosePieces ?? ''}:${item?.piecesOut ?? ''}`
  useEffect(() => {
    let live = true
    api
      .getTransactions({ itemId: id, limit: 2000 })
      .then((rows) => live && setAllTxns(rows))
      .catch(console.error)
    return () => {
      live = false
    }
  }, [id, stamp])
  const isKit = hasComponents(item)
  const txns =
    !isKit || pieceFilter === 'all'
      ? allTxns
      : allTxns.filter((t) =>
          pieceFilter === 'whole' ? !t.componentId : t.componentId === pieceFilter
        )
  const pieceLabel = (t) => (t.componentName ? t.componentName : 'Whole kit')
  const qtyText = (t, unit) =>
    isKit
      ? `${t.quantity} ${t.componentId ? 'pcs' : t.quantity === 1 ? 'set' : 'sets'}`
      : `${t.unitQuantity} ${unit?.abbreviation || ''}`

  if (!item) {
    return (
      <div className="py-20 text-center">
        <p className="text-lg text-slate-500">Item not found</p>
        <Link to="/inventory" className="mt-4 inline-block text-primary-600 hover:underline">
          ← Back to inventory
        </Link>
      </div>
    )
  }

  // Only leave the page once the server has really deleted it (it refuses, e.g., while the item is
  // still issued out, and staff accounts cannot delete at all) and show the reason instead of failing silently.
  const handleDelete = async () => {
    if (!window.confirm('Delete this item AND its whole stock history? This cannot be undone.')) return
    try {
      await deleteItem(item.id)
      navigate('/inventory')
    } catch (err) {
      alert(err.message || 'Could not delete the item')
    }
  }

  const handleExportCSV = (exportFrom, exportTo) => {
    const data = filterByDateRange(txns, 'createdAt', exportFrom, exportTo).map((t) => {
      const unit = getUnit(t.unitId)
      const evt = events.find((e) => e.id === t.eventId)
      return {
        Date: formatDateTime(t.createdAt),
        Type: t.type,
        ...(isKit ? { Piece: pieceLabel(t) } : {}),
        Quantity: t.unitQuantity,
        Unit: unit?.abbreviation || '',
        'Base Qty': t.quantity,
        Source: t.source,
        Recipient: t.recipient || '',
        Department: t.department || '',
        Event: evt?.name || '',
        Vendor: t.vendor || '',
        Notes: t.notes || '',
        By: t.performedBy,
      }
    })
    if (data.length === 0) return 'No transactions in the selected date range.'
    exportToCSV(data, `history_${item.sku}`, {
      fromDate: exportFrom,
      toDate: exportTo,
      prefiltered: true,
      title: `History - ${item.name}`,
      summary: [
        { label: 'SKU', value: item.sku },
        { label: 'Category', value: item.category },
        ...transactionsOverview(filterByDateRange(txns, 'createdAt', exportFrom, exportTo)),
      ],
      filters: [`Item: ${item.name} (${item.sku})`],
    })
  }

  const handleExportPDF = (exportFrom, exportTo) => {
    const list = filterByDateRange(txns, 'createdAt', exportFrom, exportTo)
    if (list.length === 0) return 'No transactions in the selected date range.'
    const headers = ['Date', 'Type', ...(isKit ? ['Piece'] : []), 'Qty', 'Unit', 'Recipient', 'Dept', 'Source', 'Notes', 'By']
    const rows = list.map((t) => {
      const unit = getUnit(t.unitId)
      return [
        formatDateTime(t.createdAt),
        t.type,
        ...(isKit ? [pieceLabel(t)] : []),
        t.unitQuantity,
        unit?.abbreviation || '',
        t.recipient || '',
        t.department || '',
        t.source,
        t.notes || '',
        t.performedBy,
      ]
    })
    exportToPDF(`History — ${item.name}`, headers, rows, `history_${item.sku}`, {
      fromDate: exportFrom,
      toDate: exportTo,
      summary: [
        { label: 'SKU', value: item.sku },
        { label: 'Category', value: item.category },
        ...transactionsOverview(list),
      ],
      filters: [`Item: ${item.name} (${item.sku})`],
    })
  }

  // Stock expressed in every unit that applies to this item. The item's own base unit is the
  // one the stock number is stored in (factor 1, whatever its default factor says); every other
  // unit uses the item's factor (base units per ONE of that unit): qty = stock / factor.
  const stockQty = Number(item.quantity) || 0
  const conversions = unitsForItem(item, units).map((u) => {
    const isItemBase = item.baseUnitId ? u.id === item.baseUnitId : u.isBase
    const f = isItemBase ? 1 : Number(unitFactor(u.id, item))
    const qty = Number.isFinite(f) && f > 0 ? stockQty / f : null
    return { id: u.id, name: u.name, abbr: u.abbreviation, isItemBase, qty }
  })
  const fmtConv = (n) =>
    n == null ? '—' : (Math.round(n * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })
  const convLabel = (c) => {
    const exact = c.qty != null && Math.abs(c.qty - Math.round(c.qty * 100) / 100) < 1e-6
    const plural = c.qty === 1 ? c.name : c.name.endsWith('s') ? c.name : `${c.name}s`
    return `${c.isItemBase || exact ? '' : '≈ '}${fmtConv(c.qty)} ${plural}`
  }

  const typeIcon = (type) => {
    if (type === 'receive') return <ArrowDownToLine className="h-4 w-4 text-emerald-500" />
    if (type === 'return') return <RotateCcw className="h-4 w-4 text-sky-500" />
    return <ArrowUpFromLine className="h-4 w-4 text-amber-500" />
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4">
        <Link
          to="/inventory"
          className="mt-1 flex items-center gap-1 rounded-lg px-2 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700"
        >
          <ArrowLeft className="h-5 w-5" /> <span className="hidden sm:inline">Inventory</span>
        </Link>
        <div className="flex-1">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-mono text-xs text-slate-400">{item.sku}</p>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold text-slate-900">{item.name}</h1>
                <StatusBadge status={item.itemType || 'consumable'}>
                  {item.itemType || 'consumable'}
                </StatusBadge>
                <FaultBadge itemId={item.id} link={false} />
              </div>
              <p className="mt-1 text-sm text-slate-500">{item.description}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link to={`/issue?item=${item.id}`} className="btn-primary">
                <ArrowUpFromLine className="h-4 w-4" /> Issue
              </Link>
              {isAdmin && (
                <>
                  <button onClick={() => setEditOpen(true)} className="btn-secondary">
                    <Pencil className="h-4 w-4" /> Edit
                  </button>
                  <button onClick={handleDelete} className="btn-danger">
                    <Trash2 className="h-4 w-4" /> Delete
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card p-4">
          <p className="text-xs font-medium uppercase text-slate-400">
            {item.itemType === 'kit' ? 'Complete sets in store' : 'Available in store'}
          </p>
          <p className="mt-1 text-2xl font-bold">
            {fmtQty(item.quantity)}{' '}
            <span className="text-sm font-normal text-slate-400">
              {item.itemType === 'kit' ? 'sets' : baseAbbr(item, units)}
            </span>
          </p>
          {!isKit && stockBreakdown(item, units) && (
            <p className="mt-0.5 text-xs font-medium text-slate-600">= {stockBreakdown(item, units)}</p>
          )}
          {isKit && (
            <p className="mt-0.5 text-xs text-slate-500">
              {item.totalSets != null ? `${item.totalSets} owned in total · ` : ''}{item.outstanding} {item.outstanding === 1 ? 'set' : 'sets'} out
              {item.piecesOut > 0 ? ` · ${item.piecesOut} ${item.piecesOut === 1 ? 'piece' : 'pieces'} out` : ''}
              {item.loosePieces > 0 ? ` · ${item.loosePieces} loose ${item.loosePieces === 1 ? 'piece' : 'pieces'} in store` : ''}
            </p>
          )}
          {!isKit && (
            <p className="mt-0.5 text-xs text-slate-500">
              {fmtQty(item.totalQuantity ?? item.quantity)} {baseAbbr(item, units)} owned in total
              {item.outstanding > 0 ? ` · ${fmtQty(item.outstanding)} ${baseAbbr(item, units)} out with people` : ''}
            </p>
          )}
          {item.quantity <= item.reorderLevel && (
            <StatusBadge status="low">Below reorder level</StatusBadge>
          )}
        </div>
        <div className="card p-4">
          <p className="text-xs font-medium uppercase text-slate-400">Category</p>
          <p className="mt-1 text-lg font-semibold">{item.category}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs font-medium uppercase text-slate-400">Location</p>
          <p className="mt-1 text-lg font-semibold">{item.location || '—'}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs font-medium uppercase text-slate-400">Reorder Level</p>
          <p className="mt-1 text-lg font-semibold">
            {fmtQty(item.reorderLevel)} {item.itemType === 'kit' ? 'sets' : baseAbbr(item, units)}
          </p>
        </div>
      </div>

      {isKit && (
        <div className="card">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
            <div className="flex items-center gap-2">
              <Boxes className="h-5 w-5 text-indigo-500" />
              <h2 className="font-semibold">What is in the kit</h2>
              <span className="text-xs text-slate-400">
                {item.components.length} lines · {item.componentPieces} pieces per set
                {item.piecesPerSet && item.piecesPerSet !== item.componentPieces
                  ? ` (kit says ${item.piecesPerSet})`
                  : ''}
              </span>
            </div>
            <Link to={`/issue?item=${item.id}`} className="btn-secondary text-xs">
              <ArrowUpFromLine className="h-3.5 w-3.5" /> Issue
            </Link>
          </div>

          {item.repackableSets > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-100 bg-amber-50 px-5 py-3 text-sm text-amber-900">
              <p>
                Loose pieces in store are enough to make{' '}
                <strong>{item.repackableSets} complete {item.repackableSets === 1 ? 'set' : 'sets'}</strong>.
              </p>
              <button
                className="btn-secondary text-xs"
                disabled={repacking}
                onClick={async () => {
                  setRepackError('')
                  setRepacking(true)
                  try {
                    await repackKit(item.id, item.repackableSets)
                  } catch (e) {
                    setRepackError(e.message)
                  } finally {
                    setRepacking(false)
                  }
                }}
              >
                <PackageCheck className="h-3.5 w-3.5" />
                {repacking ? 'Repacking…' : 'Repack into sets'}
              </button>
            </div>
          )}
          {repackError && <p className="px-5 py-2 text-sm text-red-600">{repackError}</p>}
          {item.loosePieces > 0 && (
            <p className="border-b border-slate-100 px-5 py-2 text-xs text-slate-500">
              <strong>In store</strong> = pieces inside the {fmtQty(item.quantity)} complete {item.quantity === 1 ? 'set' : 'sets'} + loose pieces
              left over from a set that was opened. Loose pieces join back into complete sets automatically
              once a full set's worth is back in store.
            </p>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Piece</th>
                  <th className="px-4 py-3 text-right font-medium">Per set</th>
                  <th className="px-4 py-3 text-right font-medium">In store</th>
                  <th className="px-4 py-3 text-right font-medium">Loose</th>
                  <th className="px-4 py-3 text-right font-medium">Issued out</th>
                  <th className="px-4 py-3 font-medium">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {item.components.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5">
                      <Link
                        to={`/issue?item=${item.id}&component=${c.id}`}
                        className="font-medium text-primary-600 hover:underline"
                        title="Issue this piece"
                      >
                        {c.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{c.quantityPerKit}</td>
                    <td className="px-4 py-2.5 text-right font-medium tabular-nums">
                      {c.available}
                      {c.loose > 0 && (
                        <span className="block text-xs font-normal text-slate-400">
                          {c.available - c.loose} in sets + {c.loose} loose
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">{c.loose}</td>
                    <td className={`px-4 py-2.5 text-right tabular-nums ${c.outstanding ? 'font-medium text-amber-700' : 'text-slate-400'}`}>
                      {c.outstanding}
                    </td>
                    <td className="px-4 py-2.5 text-slate-500">{c.notes || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ItemFaultsPanel item={item} />

      <div className={`card p-5 ${item.itemType === 'kit' ? 'hidden' : ''}`}>
        <h2 className="mb-3 font-semibold">Unit Conversions</h2>
        <div className="flex flex-wrap gap-3">
          {conversions.map((c) => (
            <div
              key={c.id}
              className={`rounded-lg px-4 py-2 ${c.isItemBase ? 'bg-primary-50' : 'bg-slate-100'}`}
              title={c.isItemBase ? 'Unit this item is counted in' : undefined}
            >
              <span className={`text-sm font-medium ${c.isItemBase ? 'text-primary-700' : 'text-slate-700'}`}>
                {convLabel(c)}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <h2 className="font-semibold">Issuance, Receiving & Returns History</h2>
          <div className="flex flex-wrap items-center gap-2">
            {isKit && (
              <Select
                className="input w-auto py-1 text-xs"
                value={pieceFilter}
                onChange={(e) => setPieceFilter(e.target.value)}
                title="Show history for"
              >
                <option value="all">All pieces</option>
                <option value="whole">Whole kit only</option>
                {item.components.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
            )}
            <button onClick={() => setExportFmt('csv')} className="btn-secondary text-xs">
              <Download className="h-3.5 w-3.5" /> CSV
            </button>
            <button onClick={() => setExportFmt('pdf')} className="btn-secondary text-xs">
              <FileText className="h-3.5 w-3.5" /> PDF
            </button>
          </div>
        </div>

        {txns.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-slate-400">No transactions yet</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  {isKit && <th className="px-4 py-3 font-medium">Piece</th>}
                  <th className="px-4 py-3 font-medium text-right">Qty</th>
                  <th className="px-4 py-3 font-medium">Recipient</th>
                  <th className="px-4 py-3 font-medium">Dept</th>
                  <th className="px-4 py-3 font-medium">Source</th>
                  <th className="px-4 py-3 font-medium">Details</th>
                  <th className="px-4 py-3 font-medium">By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {txns.map((t) => {
                  const unit = getUnit(t.unitId)
                  const evt = events.find((e) => e.id === t.eventId)
                  return (
                    <tr key={t.id} className="hover:bg-slate-50">
                      <td className="whitespace-nowrap px-4 py-3 text-slate-500">
                        {formatDateTime(t.createdAt)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {typeIcon(t.type)}
                          <StatusBadge status={t.type}>{t.type}</StatusBadge>
                        </div>
                      </td>
                      {isKit && (
                        <td className={`px-4 py-3 ${t.componentId ? 'text-slate-600' : 'font-medium'}`}>
                          {t.componentId && t.parentTxnId && <span className="mr-1 text-slate-300">↳</span>}
                          {pieceLabel(t)}
                        </td>
                      )}
                      <td className="px-4 py-3 text-right font-medium tabular-nums">
                        {isKit ? (
                          qtyText(t, unit)
                        ) : (
                          <>
                            {t.unitQuantity} {unit?.abbreviation}
                            <span className="ml-1 text-xs text-slate-400">({fmtQty(t.quantity)} {baseAbbr(item, units)})</span>
                          </>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{t.recipient || '—'}</td>
                      <td className="px-4 py-3 text-slate-600">{t.department || '—'}</td>
                      <td className="px-4 py-3 capitalize">{t.source?.replace('_', ' ')}</td>
                      <td className="px-4 py-3 text-slate-500">
                        {t.vendor && <span>Vendor: {t.vendor}</span>}
                        {evt && <span>Event: {evt.name}</span>}
                        {t.notes && (
                          <span className={t.vendor || evt ? 'block text-xs' : ''}>{t.notes}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-500">{t.performedBy}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <ItemFormModal open={isAdmin && editOpen} onClose={() => setEditOpen(false)} item={item} />
      <ExportDialog
        format={exportFmt}
        title="History export"
        onClose={() => setExportFmt(null)}
        onConfirm={(from, to) => (exportFmt === 'csv' ? handleExportCSV(from, to) : handleExportPDF(from, to))}
      />
    </div>
  )
}
