import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { format, parseISO, addDays } from 'date-fns'
import { CalendarDays, ChevronLeft, ChevronRight, ChevronDown, Download, FileText, SearchX } from 'lucide-react'
import { api } from '../utils/api'
import { exportToCSV, exportToPDF } from '../utils/export'
import { dailyIssuesOverview } from '../utils/exportSummary'
import StatusBadge from '../components/StatusBadge'
import EmptyState from '../components/EmptyState'
import SearchBar from '../components/SearchBar'
import Pagination from '../components/Pagination'
import { filterBySearch, normaliseQuery, sumIfSameUnit } from '../utils/usageSearch'

const ISSUES_PER_PAGE = 15
const TOTALS_PER_PAGE = 10

const toISODate = (d) => format(d, 'yyyy-MM-dd')
// "5 pk" — and when issued in a non-base unit, the base-unit equivalent too
function qtyLabel(e) {
  if (e.itemType === 'kit') {
    // kits count in complete sets; their pieces in pieces
    return `${e.quantity} ${e.componentId ? 'pcs' : e.quantity === 1 ? 'set' : 'sets'}`
  }
  const unit = e.unitAbbr ? ` ${e.unitAbbr}` : ''
  const base = e.baseUnitAbbr ? ` ${e.baseUnitAbbr}` : ''
  const main = `${e.unitQuantity}${unit}`
  return e.unitId && e.unitQuantity !== e.quantity ? `${main} (= ${e.quantity}${base})` : main
}

// "Flat bit (80-in-1 Kit)" for a piece issued on its own, otherwise the item name
const entryName = (e) => (e.componentName ? `${e.componentName} (${e.itemName})` : e.itemName)

function sourceLabel(e) {
  if (e.eventName) return `Event: ${e.eventName}`
  if (e.source === 'event') return 'Event'
  if (e.source === 'site') return 'Site'
  return e.source || '—'
}

export default function DailyIssues() {
  const today = toISODate(new Date())
  const [date, setDate] = useState(today)
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [openKits, setOpenKits] = useState(() => new Set())
  const [search, setSearch] = useState('')
  const [issuesPage, setIssuesPage] = useState(1)
  const [totalsPage, setTotalsPage] = useState(1)
  const [totalsSearch, setTotalsSearch] = useState('') // search inside "Totals by item"

  // "A day" means the viewer's local day, not the server's
  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', [])

  useEffect(() => {
    if (!date) return
    let cancelled = false
    setLoading(true)
    setError('')
    api
      .getDailyIssues(date, tz)
      .then((res) => !cancelled && setEntries(res.entries || []))
      .catch((e) => {
        if (cancelled) return
        setEntries([])
        setError(e.message || 'Failed to load issues')
      })
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [date, tz])

  useEffect(() => {
    setIssuesPage(1)
    setTotalsPage(1)
  }, [date, search])

  // a new day or a new search term starts the totals list on its first page
  useEffect(() => {
    setTotalsPage(1)
  }, [date, totalsSearch])

  // a different day starts with a clean totals search
  useEffect(() => {
    setTotalsSearch('')
  }, [date])

  const shiftDay = (n) => setDate(toISODate(addDays(parseISO(date), n)))

  // Whole-kit issues also log one line per piece (parentTxnId). Those lines are shown
  // under their kit line, and are left out of counts/totals so nothing is counted twice.
  const topLevel = useMemo(() => entries.filter((e) => !e.parentTxnId), [entries])
  const partsOf = useMemo(() => {
    const m = new Map()
    for (const e of entries) {
      if (e.parentTxnId) m.set(e.parentTxnId, [...(m.get(e.parentTxnId) || []), e])
    }
    return m
  }, [entries])
  const toggleKit = (id) =>
    setOpenKits((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const summarise = (list) => {
    const map = new Map()
    for (const e of list) {
      const key = `${e.itemId}:${e.componentId || ''}`
      const row = map.get(key) || {
        key,
        itemId: e.itemId,
        name: entryName(e),
        sku: e.itemSku,
        itemType: e.componentId ? 'component' : e.itemType,
        unit: e.itemType === 'kit' ? (e.componentId ? 'pcs' : 'sets') : e.baseUnitAbbr,
        total: 0,
        count: 0,
      }
      row.total += e.quantity
      row.count += 1
      map.set(key, row)
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
  }
  const byItem = useMemo(() => summarise(topLevel), [topLevel])

  // Search: matches the issue line or any piece issued with it
  const query = search.trim().toLowerCase()
  const filteredTop = useMemo(() => {
    if (!query) return topLevel
    const hay = (e) =>
      [e.itemName, e.itemSku, e.componentName, e.recipient, e.department, e.eventName, e.source, e.performedBy, e.notes]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
    return topLevel.filter((e) => hay(e).includes(query) || (partsOf.get(e.id) || []).some((p) => hay(p).includes(query)))
  }, [topLevel, partsOf, query])
  const filteredIds = useMemo(() => new Set(filteredTop.map((e) => e.id)), [filteredTop])
  // Same set including piece lines, used for export so it matches what is on screen
  const filteredEntries = useMemo(
    () => (query ? entries.filter((e) => filteredIds.has(e.parentTxnId || e.id)) : entries),
    [entries, filteredIds, query]
  )
  const shownTotals = useMemo(() => summarise(filteredTop), [filteredTop])

  // "Totals by item" has its own search (item name, SKU, type) on top of the page search
  const totalsQuery = normaliseQuery(totalsSearch)
  const visibleTotals = useMemo(
    () => filterBySearch(shownTotals, totalsQuery, (r) => [r.name, r.sku, r.itemType, r.unit]),
    [shownTotals, totalsQuery]
  )
  const matchTotal = useMemo(
    () => (totalsQuery ? sumIfSameUnit(visibleTotals, (r) => r.total, (r) => r.unit) : null),
    [visibleTotals, totalsQuery]
  )

  const issuesPages = Math.max(1, Math.ceil(filteredTop.length / ISSUES_PER_PAGE))
  const totalsPages = Math.max(1, Math.ceil(visibleTotals.length / TOTALS_PER_PAGE))
  const pagedIssues = filteredTop.slice((issuesPage - 1) * ISSUES_PER_PAGE, issuesPage * ISSUES_PER_PAGE)
  const currentTotalsPage = Math.min(totalsPage, totalsPages) // stays valid if the list shrinks
  const pagedTotals = visibleTotals.slice((currentTotalsPage - 1) * TOTALS_PER_PAGE, currentTotalsPage * TOTALS_PER_PAGE)

  const recipientCount = useMemo(
    () => new Set(topLevel.map((e) => (e.recipient || '').trim().toLowerCase()).filter(Boolean)).size,
    [topLevel]
  )

  const timeOf = (e) => format(parseISO(e.createdAt), 'HH:mm')

  const handleExportCSV = () => {
    const data = filteredEntries.map((e) => ({
      Date: date,
      Time: timeOf(e),
      SKU: e.itemSku,
      Item: e.itemName,
      Piece: e.componentName || (e.itemType === 'kit' ? 'Whole kit' : ''),
      Quantity: e.itemType === 'kit' ? e.quantity : e.unitQuantity,
      Unit: e.itemType === 'kit' ? (e.componentId ? 'pcs' : 'sets') : e.unitAbbr || '',
      'Quantity (base units)': e.quantity,
      Recipient: e.recipient || '',
      Department: e.department || '',
      Event: e.eventName || '',
      'Issued By': e.performedBy || '',
      Notes: e.notes || '',
    }))
    exportToCSV(data, 'daily-issues', {
      fromDate: date,
      toDate: date,
      prefiltered: true,
      title: 'Daily Issues',
      summary: dailyIssuesOverview(filteredEntries),
      filters: query ? [`Search: "${query}"`] : null,
    })
  }

  const handleExportPDF = () => {
    const headers = ['Time', 'SKU', 'Item', 'Qty', 'Recipient', 'Department', 'Event / Source', 'Issued By', 'Notes']
    const rows = filteredEntries.map((e) =>
      [timeOf(e), e.itemSku, `${e.parentTxnId ? '↳ ' : ''}${entryName(e)}`, qtyLabel(e), e.recipient, e.department, sourceLabel(e), e.performedBy, e.notes]
    )
    exportToPDF(`Daily Issues – ${format(parseISO(date), 'PPP')}`, headers, rows, 'daily-issues', {
      fromDate: date,
      toDate: date,
      summary: dailyIssuesOverview(filteredEntries),
      filters: query ? [`Search: "${query}"`] : null,
      rowKinds: filteredEntries.map((e) => (e.parentTxnId ? 'child' : 'item')),
    })
  }

  // ---- "Totals by item" export: the items used that day, with the quantity of each (all pages) ----
  const totalsFilters = () => [
    ...(query ? [`Search: "${query}"`] : []),
    ...(totalsQuery ? [`Item search: "${totalsQuery}"`] : []),
  ]
  const totalsSummary = () => [
    { label: 'Date', value: format(parseISO(date), 'PPP') },
    { label: 'Different items', value: visibleTotals.length },
    { label: 'Issue entries', value: visibleTotals.reduce((t, r) => t + r.count, 0) },
  ]

  const handleTotalsCSV = () => {
    if (visibleTotals.length === 0) return
    exportToCSV(
      visibleTotals.map((r) => ({
        Date: date,
        SKU: r.sku || '',
        Item: r.name,
        Type: r.itemType,
        Entries: r.count,
        'Total Issued': r.total,
        Unit: r.unit || '',
      })),
      `daily-items-used_${date}`,
      {
        fromDate: date,
        toDate: date,
        prefiltered: true,
        title: `Items Used - ${date}`,
        summary: totalsSummary(),
        filters: totalsFilters().length ? totalsFilters() : null,
      }
    )
  }

  const handleTotalsPDF = () => {
    if (visibleTotals.length === 0) return
    exportToPDF(
      `Items Used – ${format(parseISO(date), 'PPP')}`,
      ['SKU', 'Item', 'Type', 'Entries', 'Total issued', 'Unit'],
      visibleTotals.map((r) => [r.sku || '', r.name, r.itemType, r.count, r.total, r.unit || '']),
      `daily-items-used_${date}`,
      {
        fromDate: date,
        toDate: date,
        summary: totalsSummary(),
        filters: totalsFilters().length ? totalsFilters() : null,
      }
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Daily Issues</h1>
          <p className="text-sm text-slate-500">
            Everything issued out on {date ? format(parseISO(date), 'EEEE, MMM d, yyyy') : '…'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={handleExportCSV} className="btn-secondary" disabled={!filteredEntries.length}>
            <Download className="h-4 w-4" /> CSV
          </button>
          <button onClick={handleExportPDF} className="btn-secondary" disabled={!filteredEntries.length}>
            <FileText className="h-4 w-4" /> PDF
          </button>
        </div>
      </div>

      {/* Date picker */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
        <button
          type="button"
          className="btn-ghost px-2 py-1.5"
          onClick={() => shiftDay(-1)}
          disabled={!date}
          title="Previous day"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <input
          type="date"
          className="input w-auto py-1"
          value={date}
          max={today}
          onChange={(e) => e.target.value && setDate(e.target.value)}
        />
        <button
          type="button"
          className="btn-ghost px-2 py-1.5"
          onClick={() => shiftDay(1)}
          disabled={!date || date >= today}
          title="Next day"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        {date !== today && (
          <button
            type="button"
            className="text-sm text-primary-600 hover:underline"
            onClick={() => setDate(today)}
          >
            Today
          </button>
        )}
      </div>

      {entries.length > 0 && (
        <SearchBar
          value={search}
          onChange={setSearch}
          placeholder="Search item, SKU, recipient, department, event, notes…"
        />
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        {[
          ['Issue entries', topLevel.length],
          ['Different items', byItem.length],
          ['Recipients', recipientCount],
        ].map(([label, value]) => (
          <div key={label} className="card px-4 py-3">
            <p className="text-xs uppercase text-slate-500">{label}</p>
            <p className="text-2xl font-semibold tabular-nums text-slate-900">{loading ? '…' : value}</p>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-500 border-t-transparent" />
        </div>
      ) : entries.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={CalendarDays}
            title="Nothing issued on this day"
            description="Pick another date to see what was issued out."
          />
        </div>
      ) : (
        filteredTop.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={CalendarDays}
            title="No matching issues"
            description="Try a different search term."
          />
        </div>
      ) : (
        <>
          <div className="card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
              <h2 className="text-sm font-semibold text-slate-700">Totals by item</h2>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleTotalsCSV}
                  disabled={visibleTotals.length === 0}
                  className="btn-secondary text-xs"
                  title="Export the items used on this day as CSV"
                >
                  <Download className="h-3.5 w-3.5" /> CSV
                </button>
                <button
                  type="button"
                  onClick={handleTotalsPDF}
                  disabled={visibleTotals.length === 0}
                  className="btn-secondary text-xs"
                  title="Export the items used on this day as PDF"
                >
                  <FileText className="h-3.5 w-3.5" /> PDF
                </button>
              </div>
            </div>
            <div className="space-y-2 border-b border-slate-100 px-4 py-3">
              <SearchBar
                value={totalsSearch}
                onChange={setTotalsSearch}
                placeholder="Search item name or SKU to see how much was issued…"
              />
              {totalsQuery && (
                <p className="text-xs text-slate-500" aria-live="polite">
                  {visibleTotals.length} of {shownTotals.length} items
                  {matchTotal && visibleTotals.length > 0 && (
                    <>
                      {' · '}Total issued for matches:{' '}
                      <span className="font-semibold text-slate-700">
                        {matchTotal.total} {matchTotal.unit}
                      </span>
                    </>
                  )}
                </p>
              )}
            </div>
            {visibleTotals.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-5 py-10 text-center text-sm text-slate-400">
                <SearchX className="h-6 w-6" />
                <p>No items match “{totalsSearch.trim()}”</p>
                <button type="button" className="text-primary-600 hover:underline" onClick={() => setTotalsSearch('')}>
                  Clear search
                </button>
              </div>
            ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">SKU</th>
                    <th className="px-4 py-3 font-medium">Item</th>
                    <th className="px-4 py-3 font-medium">Type</th>
                    <th className="px-4 py-3 font-medium text-right">Entries</th>
                    <th className="px-4 py-3 font-medium text-right">Total issued</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pagedTotals.map((r) => (
                    <tr key={r.key} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-mono text-xs text-slate-500">{r.sku}</td>
                      <td className="px-4 py-3">
                        <Link to={`/inventory/${r.itemId}`} className="font-medium text-primary-600 hover:underline">
                          {r.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={r.itemType}>{r.itemType}</StatusBadge>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-600">{r.count}</td>
                      <td className="px-4 py-3 text-right font-medium tabular-nums">
                        {r.total}
                        {r.unit ? <span className="ml-1 text-xs font-normal text-slate-400">{r.unit}</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            )}
            {totalsPages > 1 && (
              <div className="px-4 pb-4">
                <Pagination page={currentTotalsPage} totalPages={totalsPages} onPageChange={setTotalsPage} />
              </div>
            )}
          </div>

          <div className="card overflow-hidden">
            <h2 className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700">
              All issues
              {query && <span className="ml-2 font-normal text-slate-400">({filteredTop.length} of {topLevel.length})</span>}
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Time</th>
                    <th className="px-4 py-3 font-medium">Item</th>
                    <th className="px-4 py-3 font-medium text-right">Qty</th>
                    <th className="px-4 py-3 font-medium">Recipient</th>
                    <th className="px-4 py-3 font-medium">Department</th>
                    <th className="px-4 py-3 font-medium">Event / Source</th>
                    <th className="px-4 py-3 font-medium">Issued by</th>
                    <th className="px-4 py-3 font-medium">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pagedIssues.flatMap((e) => {
                    const parts = partsOf.get(e.id) || []
                    const open = openKits.has(e.id)
                    const row = (x, child) => (
                      <tr key={x.id} className={child ? 'bg-slate-50/70 text-slate-600' : 'hover:bg-slate-50'}>
                        <td className="whitespace-nowrap px-4 py-3 tabular-nums text-slate-500">
                          {child ? '' : timeOf(x)}
                        </td>
                        <td className={`px-4 ${child ? 'py-1.5 pl-10' : 'py-3'}`}>
                          {child ? (
                            <span><span className="mr-1 text-slate-300">↳</span>{x.componentName}</span>
                          ) : (
                            <div className="flex items-center gap-1.5">
                              {parts.length > 0 && (
                                <button
                                  type="button"
                                  onClick={() => toggleKit(x.id)}
                                  className="-ml-1 rounded p-0.5 text-slate-400 hover:bg-slate-100"
                                  aria-expanded={open}
                                  title={open ? 'Hide pieces' : 'Show every piece issued with it'}
                                >
                                  {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                </button>
                              )}
                              <div>
                                <Link to={`/inventory/${x.itemId}`} className="font-medium text-primary-600 hover:underline">
                                  {entryName(x)}
                                </Link>
                                <div className="font-mono text-xs text-slate-400">
                                  {x.itemSku}
                                  {parts.length > 0 && ` · whole kit, ${parts.length} pieces`}
                                </div>
                              </div>
                            </div>
                          )}
                        </td>
                        <td className={`whitespace-nowrap px-4 text-right tabular-nums ${child ? 'py-1.5' : 'py-3 font-medium'}`}>
                          {qtyLabel(x)}
                        </td>
                        <td className="px-4 py-3">{child ? '' : x.recipient || '—'}</td>
                        <td className="px-4 py-3 text-slate-600">{child ? '' : x.department || '—'}</td>
                        <td className="px-4 py-3 text-slate-600">{child ? '' : sourceLabel(x)}</td>
                        <td className="px-4 py-3 text-slate-500">{child ? '' : x.performedBy || '—'}</td>
                        <td className="px-4 py-3 text-slate-500">{child ? '' : x.notes || '—'}</td>
                      </tr>
                    )
                    return [row(e, false), ...(open ? parts.map((p) => row(p, true)) : [])]
                  })}
                </tbody>
              </table>
            </div>
            {issuesPages > 1 && (
              <div className="px-4 pb-4">
                <Pagination page={issuesPage} totalPages={issuesPages} onPageChange={setIssuesPage} />
              </div>
            )}
          </div>
        </>
      )
      )}
    </div>
  )
}
