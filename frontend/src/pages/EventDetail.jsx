import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  ArrowLeft,
  Calendar,
  Download,
  FileText,
  ArrowUpFromLine,
  RotateCcw,
  SearchX,
} from 'lucide-react'
import { useInventory } from '../context/InventoryContext'
import { api } from '../utils/api'
import StatusBadge from '../components/StatusBadge'
import { formatDate, formatDateTime } from '../utils/format'
import { exportToCSV, exportToPDF, filterByDateRange } from '../utils/export'
import { transactionsOverview, eventDatesLabel } from '../utils/exportSummary'
import Pagination from '../components/Pagination'
import ExportDialog from '../components/ExportDialog'
import { txnItemLabel } from '../utils/kits'
import { baseAbbr } from '../utils/units'
import SearchBar from '../components/SearchBar'
import { filterBySearch, normaliseQuery, sumIfSameUnit } from '../utils/usageSearch'

const USAGE_PER_PAGE = 8 // rows of "Stock Used" per page, so the Transaction Log below stays in place

export default function EventDetail() {
  const { id } = useParams()
  const { events, items, units, getUnit } = useInventory()
  const [exportFmt, setExportFmt] = useState(null) // 'csv' | 'pdf' | null
  const [usagePage, setUsagePage] = useState(1)
  const [usageSearch, setUsageSearch] = useState('')

  // a different event starts on its first page with a clean search
  useEffect(() => {
    setUsagePage(1)
    setUsageSearch('')
  }, [id])

  // a new search starts on the first page
  useEffect(() => {
    setUsagePage(1)
  }, [usageSearch])

  const event = events.find((e) => e.id === id)
  const [txns, setTxns] = useState([])
  useEffect(() => {
    let live = true
    api
      .getEventTransactions(id)
      .then((rows) => live && setTxns(rows))
      .catch(console.error)
    return () => {
      live = false
    }
  }, [id])

  if (!event) {
    return (
      <div className="py-20 text-center">
        <p className="text-lg text-slate-500">Event not found</p>
        <Link to="/events" className="mt-4 inline-block text-primary-600 hover:underline">
          ← Back to events
        </Link>
      </div>
    )
  }

  // Aggregate issued quantities per item (issue - return)
  // Kits: sets and single pieces are counted separately, and the per-piece lines that a
  // whole-kit issue writes (parentTxnId) are skipped so nothing is counted twice.
  const usageMap = {}
  txns.forEach((t) => {
    if (t.parentTxnId) return
    const key = `${t.itemId}:${t.componentId || ''}`
    if (!usageMap[key]) {
      usageMap[key] = { itemId: t.itemId, componentName: t.componentName, componentId: t.componentId, issued: 0, returned: 0, txns: [] }
    }
    if (t.type === 'issue') usageMap[key].issued += t.quantity
    if (t.type === 'return') usageMap[key].returned += t.quantity
    usageMap[key].txns.push(t)
  })

  const usageRows = Object.entries(usageMap).map(([key, data]) => {
    const item = items.find((i) => i.id === data.itemId)
    return {
      key,
      label: txnItemLabel(data, item),
      unitLabel: item?.itemType === 'kit' ? (data.componentId ? 'pcs' : 'sets') : baseAbbr(item, units),
      item,
      issued: data.issued,
      returned: data.returned,
      net: data.issued - data.returned,
      txns: data.txns,
    }
  })

  // ---- "Stock Used for this Event": paging + export (always covers every row, not just the current page) ----
  const usageType = (r) => (r.componentId ? 'piece' : r.item?.itemType || 'consumable')
  const usageQuery = normaliseQuery(usageSearch)
  // Search by item name, SKU, type or piece name; the summary cards above always count the whole event
  const shownUsage = filterBySearch(usageRows, usageQuery, (r) => [r.label, r.item?.name, r.item?.sku, usageType(r), r.unitLabel])
  const usagePages = Math.max(1, Math.ceil(shownUsage.length / USAGE_PER_PAGE))
  const currentUsagePage = Math.min(usagePage, usagePages) // stays valid if the list shrinks
  const pagedUsage = shownUsage.slice((currentUsagePage - 1) * USAGE_PER_PAGE, currentUsagePage * USAGE_PER_PAGE)
  const totalIssued = usageRows.reduce((s, r) => s + r.issued, 0)
  const totalReturned = usageRows.reduce((s, r) => s + r.returned, 0)
  // Combined figures for the rows matching the search (only when they share one unit)
  const matchNet = usageQuery ? sumIfSameUnit(shownUsage, (r) => r.net, (r) => r.unitLabel) : null
  const usageFilters = () => [`Event: ${event.name}`, ...(usageQuery ? [`Search: "${usageQuery}"`] : [])]
  const usageSummary = () => {
    const issued = shownUsage.reduce((s, r) => s + r.issued, 0)
    const returned = shownUsage.reduce((s, r) => s + r.returned, 0)
    return [
      { label: 'Event status', value: event.status },
      { label: 'Event dates', value: eventDatesLabel(event.startDate, event.endDate) },
      { label: 'Items used', value: shownUsage.length },
      { label: 'Total issued (pcs)', value: issued },
      { label: 'Total returned (pcs)', value: returned },
      { label: 'Net used (pcs)', value: issued - returned },
    ]
  }

  const handleUsageCSV = () => {
    if (shownUsage.length === 0) return
    exportToCSV(
      shownUsage.map((r) => ({
        Item: r.label,
        SKU: r.item?.sku || '',
        Type: usageType(r),
        Issued: r.issued,
        Returned: r.returned,
        'Net Used': r.net,
        Unit: r.unitLabel,
      })),
      `event_stock_used_${event.name}`,
      {
        prefiltered: true,
        title: `Stock Used - ${event.name}`,
        summary: usageSummary(),
        filters: usageFilters(),
      }
    )
  }

  const handleUsagePDF = () => {
    if (shownUsage.length === 0) return
    exportToPDF(
      `Stock Used — ${event.name}`,
      ['Item', 'SKU', 'Type', 'Issued', 'Returned', 'Net used', 'Unit'],
      shownUsage.map((r) => [r.label, r.item?.sku || '', usageType(r), r.issued, r.returned, r.net, r.unitLabel]),
      `event_stock_used_${event.name}`,
      { summary: usageSummary(), filters: usageFilters() }
    )
  }

  const handleExportCSV = (exportFrom, exportTo) => {
    const data = filterByDateRange(txns, 'createdAt', exportFrom, exportTo).map((t) => {
      const item = items.find((i) => i.id === t.itemId)
      const unit = getUnit(t.unitId)
      return {
        Date: formatDateTime(t.createdAt),
        Type: t.type,
        Item: txnItemLabel(t, item),
        SKU: item?.sku || '',
        Quantity: t.unitQuantity,
        Unit: unit?.abbreviation || '',
        'Base Qty': t.quantity,
        Recipient: t.recipient || '',
        Department: t.department || '',
        Notes: t.notes || '',
        By: t.performedBy,
      }
    })
    if (data.length === 0) return 'No transactions in the selected date range.'
    exportToCSV(data, `event_${event.name.replace(/\s+/g, '_')}`, {
      fromDate: exportFrom,
      toDate: exportTo,
      prefiltered: true,
      title: `Event Stock - ${event.name}`,
      summary: [
        { label: 'Event status', value: event.status },
        { label: 'Event dates', value: eventDatesLabel(event.startDate, event.endDate) },
        ...transactionsOverview(filterByDateRange(txns, 'createdAt', exportFrom, exportTo)),
      ],
      filters: [`Event: ${event.name}`],
    })
  }

  const handleExportPDF = (exportFrom, exportTo) => {
    const list = filterByDateRange(txns, 'createdAt', exportFrom, exportTo)
    if (list.length === 0) return 'No transactions in the selected date range.'
    const headers = ['Date', 'Type', 'Item', 'Qty', 'Unit', 'Recipient', 'Dept', 'By']
    const rows = list.map((t) => {
      const item = items.find((i) => i.id === t.itemId)
      const unit = getUnit(t.unitId)
      return [
        formatDateTime(t.createdAt),
        t.type,
        txnItemLabel(t, item),
        t.unitQuantity,
        unit?.abbreviation || '',
        t.recipient || '',
        t.department || '',
        t.performedBy,
      ]
    })
    exportToPDF(`Event Stock — ${event.name}`, headers, rows, `event_${event.name}`, {
      fromDate: exportFrom,
      toDate: exportTo,
      summary: [
        { label: 'Event status', value: event.status },
        { label: 'Event dates', value: eventDatesLabel(event.startDate, event.endDate) },
        ...transactionsOverview(list),
      ],
      filters: [`Event: ${event.name}`],
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4">
        <Link
          to="/events"
          className="mt-1 flex items-center gap-1 rounded-lg px-2 py-2 text-sm font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700"
        >
          <ArrowLeft className="h-5 w-5" /> <span className="hidden sm:inline">Events</span>
        </Link>
        <div className="flex-1">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <Calendar className="h-5 w-5 text-primary-500" />
                <h1 className="text-2xl font-bold text-slate-900">{event.name}</h1>
                <StatusBadge status={event.status}>{event.status}</StatusBadge>
              </div>
              <p className="mt-1 text-sm text-slate-500">{event.description}</p>
              <p className="mt-1 text-xs text-slate-400">
                📍 {event.location} · {formatDate(event.startDate)}
                {event.endDate !== event.startDate && ` → ${formatDate(event.endDate)}`}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="card p-4">
          <p className="text-xs font-medium uppercase text-slate-400">Items used</p>
          <p className="mt-1 text-2xl font-bold">{usageRows.length}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs font-medium uppercase text-slate-400">Total issued (pcs)</p>
          <p className="mt-1 text-2xl font-bold">
            {totalIssued}
          </p>
        </div>
        <div className="card p-4">
          <p className="text-xs font-medium uppercase text-slate-400">Total returned (pcs)</p>
          <p className="mt-1 text-2xl font-bold">
            {totalReturned}
          </p>
        </div>
      </div>

      {/* Stock usage summary */}
      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <h2 className="font-semibold">Stock Used for this Event</h2>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={handleUsageCSV} disabled={shownUsage.length === 0} className="btn-secondary text-xs">
              <Download className="h-3.5 w-3.5" /> CSV
            </button>
            <button onClick={handleUsagePDF} disabled={shownUsage.length === 0} className="btn-secondary text-xs">
              <FileText className="h-3.5 w-3.5" /> PDF
            </button>
          </div>
        </div>
        {usageRows.length > 0 && (
          <div className="space-y-2 border-b border-slate-100 px-5 py-3">
            <SearchBar
              value={usageSearch}
              onChange={setUsageSearch}
              placeholder="Search item name or SKU to see how much was used…"
            />
            {usageQuery && (
              <p className="text-xs text-slate-500" aria-live="polite">
                {shownUsage.length} of {usageRows.length} items
                {matchNet && shownUsage.length > 0 && (
                  <>
                    {' · '}Net used for matches:{' '}
                    <span className="font-semibold text-slate-700">
                      {matchNet.total} {matchNet.unit}
                    </span>
                  </>
                )}
              </p>
            )}
          </div>
        )}
        {usageRows.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-slate-400">
            No stock has been issued for this event yet
          </p>
        ) : shownUsage.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-5 py-10 text-center text-sm text-slate-400">
            <SearchX className="h-6 w-6" />
            <p>No items match “{usageSearch.trim()}”</p>
            <button type="button" className="text-primary-600 hover:underline" onClick={() => setUsageSearch('')}>
              Clear search
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Item</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium text-right">Issued</th>
                  <th className="px-4 py-3 font-medium text-right">Returned</th>
                  <th className="px-4 py-3 font-medium text-right">Net used</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pagedUsage.map((row) => (
                  <tr key={row.key} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      {row.item ? (
                        <Link
                          to={`/inventory/${row.item.id}`}
                          className="font-medium text-primary-600 hover:underline"
                        >
                          {row.label}
                        </Link>
                      ) : (
                        'Unknown'
                      )}
                      <p className="text-xs text-slate-400">{row.item?.sku}</p>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={row.componentId ? 'component' : row.item?.itemType || 'consumable'}>
                        {row.componentId ? 'piece' : row.item?.itemType || 'consumable'}
                      </StatusBadge>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{row.issued} {row.unitLabel}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-sky-600">
                      {row.returned} {row.unitLabel}
                    </td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums">
                      {row.net} {row.unitLabel}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {usagePages > 1 && (
          <div className="px-4 pb-4">
            <Pagination page={currentUsagePage} totalPages={usagePages} onPageChange={setUsagePage} />
          </div>
        )}
      </div>

      {/* Full transaction log */}
      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <h2 className="font-semibold">Transaction Log</h2>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => setExportFmt('csv')} className="btn-secondary text-xs">
              <Download className="h-3.5 w-3.5" /> CSV
            </button>
            <button onClick={() => setExportFmt('pdf')} className="btn-secondary text-xs">
              <FileText className="h-3.5 w-3.5" /> PDF
            </button>
          </div>
        </div>

        {txns.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-slate-400">No transactions</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Item</th>
                  <th className="px-4 py-3 font-medium text-right">Qty</th>
                  <th className="px-4 py-3 font-medium">Recipient</th>
                  <th className="px-4 py-3 font-medium">Dept</th>
                  <th className="px-4 py-3 font-medium">Notes</th>
                  <th className="px-4 py-3 font-medium">By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {txns.map((t) => {
                  const item = items.find((i) => i.id === t.itemId)
                  const unit = getUnit(t.unitId)
                  return (
                    <tr key={t.id} className="hover:bg-slate-50">
                      <td className="whitespace-nowrap px-4 py-3 text-slate-500">
                        {formatDateTime(t.createdAt)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {t.type === 'return' ? (
                            <RotateCcw className="h-4 w-4 text-sky-500" />
                          ) : (
                            <ArrowUpFromLine className="h-4 w-4 text-amber-500" />
                          )}
                          <StatusBadge status={t.type}>{t.type}</StatusBadge>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {item ? (
                          <Link
                            to={`/inventory/${item.id}`}
                            className="text-primary-600 hover:underline"
                          >
                            {txnItemLabel(t, item)}
                          </Link>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {item?.itemType === 'kit'
                          ? `${t.quantity} ${t.componentId ? 'pcs' : t.quantity === 1 ? 'set' : 'sets'}`
                          : `${t.unitQuantity} ${unit?.abbreviation || ''}`}
                      </td>
                      <td className="px-4 py-3">{t.recipient || '—'}</td>
                      <td className="px-4 py-3">{t.department || '—'}</td>
                      <td className="px-4 py-3 text-slate-500">{t.notes || '—'}</td>
                      <td className="px-4 py-3 text-slate-500">{t.performedBy}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <ExportDialog
        format={exportFmt}
        title="Event transactions"
        onClose={() => setExportFmt(null)}
        onConfirm={(from, to) => (exportFmt === 'csv' ? handleExportCSV(from, to) : handleExportPDF(from, to))}
      />
    </div>
  )
}
