import { useEffect, useState } from 'react'
import { ArrowDownToLine, History, RotateCw, X } from 'lucide-react'
import { api } from '../utils/api'
import { useInventory } from '../context/InventoryContext'
import { formatDateTime } from '../utils/format'
import { txnItemLabel } from '../utils/kits'
import SearchBar from './SearchBar'
import Pagination from './Pagination'
import ServerExportButtons from './ServerExportButtons'
import EmptyState from './EmptyState'

const PAGE_SIZE = 8

/**
 * Server-paginated history of stock receipts (type = 'receive') for the Receive Stock page.
 *  - itemId  : only this item's receipts (with a removable chip); otherwise all receipts + search.
 *  - onClearItem : called when the item chip is dismissed.
 *  - refreshKey : bump to reload (e.g. right after a receipt is saved).
 *  - onReceiveAgain(item, txn) : optional; lets the user re-use an earlier receipt's item/source/vendor.
 */
export default function ReceiptHistory({ itemId = null, refreshKey = 0, onReceiveAgain, onClearItem }) {
  const { items, getUnit } = useInventory()
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState({ rows: [], total: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadTick, setReloadTick] = useState(0)

  // wait for the user to stop typing before hitting the server
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  // a new filter always starts on page 1
  useEffect(() => {
    setPage(1)
  }, [debounced, itemId])

  useEffect(() => {
    let live = true
    setLoading(true)
    setError('')
    api
      .getTransactions({
        type: 'receive',
        topLevel: 1,
        withTotal: 1,
        ...(itemId ? { itemId } : {}),
        ...(!itemId && debounced ? { search: debounced } : {}),
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      })
      .then((res) => {
        if (!live) return
        const total = res.total || 0
        const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
        if (page > pages) return setPage(pages)
        setData({ rows: res.transactions || [], total })
      })
      .catch((e) => live && setError(e.message || 'Failed to load receipt history'))
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
  }, [itemId, debounced, page, refreshKey, reloadTick])

  const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE))
  const itemName = itemId ? items.find((i) => i.id === itemId)?.name : null

  return (
    <div className="card p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
            <History className="h-4 w-4 text-slate-400" />
            Receipt history
          </h2>
          <p className="text-xs text-slate-400">
            {data.total.toLocaleString()} receipt{data.total === 1 ? '' : 's'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setReloadTick((n) => n + 1)}
          className="btn-ghost px-2 py-1.5"
          title="Refresh"
          aria-label="Refresh receipt history"
        >
          <RotateCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Export exactly what this list shows: the same item or search, optionally limited to a date range. */}
      <ServerExportButtons
        className="mb-3"
        dataset="receipts"
        title={itemId && itemName ? `Receipt history – ${itemName}` : 'Receipt history'}
        params={itemId ? { itemId } : debounced ? { search: debounced } : {}}
        withRange
        rangeLabel="Received between"
        disabled={!loading && data.total === 0}
      />

      {itemId && (
        <div className="mb-3 inline-flex max-w-full items-center gap-2 rounded-full border border-primary-200 bg-primary-50 py-1 pl-3 pr-1.5 text-xs font-medium text-primary-700">
          <span className="truncate">Item: {itemName || 'Selected item'}</span>
          {onClearItem && (
            <button type="button" onClick={onClearItem} aria-label="Show all items" className="rounded-full p-0.5 hover:bg-primary-100">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      {!itemId && (
        <div className="mb-3">
          <SearchBar value={search} onChange={setSearch} placeholder="Search item, SKU, vendor, notes, recorded by…" />
        </div>
      )}

      {error && <p className="mb-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      {data.rows.length === 0 ? (
        loading ? (
          <p className="py-8 text-center text-sm text-slate-400">Loading…</p>
        ) : (
          <EmptyState
            icon={History}
            title="No receipts found"
            description={itemId ? 'This item has not been received yet.' : debounced ? 'Nothing matches your search.' : 'Received stock will be listed here.'}
          />
        )
      ) : (
        <div className={`divide-y divide-slate-100 rounded-lg border border-slate-200 ${loading ? 'opacity-60' : ''}`}>
          {data.rows.map((txn) => {
            const item = items.find((i) => i.id === txn.itemId)
            const unit = getUnit(txn.unitId)
            const isKit = item?.itemType === 'kit'
            const unitLabel = isKit ? (txn.componentId ? 'pcs' : 'sets') : unit?.abbreviation
            const from = txn.source === 'head_office' ? 'Head Office' : txn.vendor ? `Vendor: ${txn.vendor}` : 'Vendor'
            return (
              <div key={txn.id} className="flex items-start gap-3 px-4 py-3">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100">
                  <ArrowDownToLine className="h-4 w-4 text-emerald-600" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{txnItemLabel(txn, item)}</p>
                  <p className="text-xs text-slate-500">
                    <strong className="tabular-nums text-slate-700">+{txn.unitQuantity} {unitLabel}</strong> · {from}
                  </p>
                  <p className="text-xs text-slate-400">
                    {formatDateTime(txn.createdAt)} · by {txn.performedBy || 'Unknown'}
                  </p>
                  {txn.notes && <p className="mt-0.5 truncate text-xs italic text-slate-400">“{txn.notes}”</p>}
                </div>
                {onReceiveAgain && item && (
                  <button
                    type="button"
                    onClick={() => onReceiveAgain(item, txn)}
                    className="shrink-0 text-xs text-primary-600 hover:underline"
                  >
                    Receive again
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
    </div>
  )
}
