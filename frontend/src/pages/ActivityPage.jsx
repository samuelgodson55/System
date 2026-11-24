import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Activity } from 'lucide-react'
import { useInventory } from '../context/InventoryContext'
import { api } from '../utils/api'
import ActivityRow from '../components/ActivityRow'
import EmptyState from '../components/EmptyState'
import Pagination from '../components/Pagination'
import ServerExportButtons from '../components/ServerExportButtons'

const PAGE_SIZE = 20
const TYPES = [
  { value: '', label: 'All activity' },
  { value: 'receive', label: 'Received' },
  { value: 'issue', label: 'Issued' },
  { value: 'return', label: 'Returned' },
]

/** Full, server-paginated transaction history (the "View all" of Dashboard → Recent Activity). */
export default function ActivityPage() {
  const { items, getUnit } = useInventory()
  const [type, setType] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState({ rows: [], total: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    setLoading(true)
    setError('')
    api
      .getTransactions({
        topLevel: 1,
        withTotal: 1,
        ...(type ? { type } : {}),
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
      .catch((e) => live && setError(e.message || 'Failed to load activity'))
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
  }, [type, page])

  const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE))

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link to="/" className="mb-1 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
            <ArrowLeft className="h-4 w-4" /> Dashboard
          </Link>
          <h1 className="text-2xl font-bold text-slate-900">Activity</h1>
          <p className="text-sm text-slate-500">{data.total.toLocaleString()} transactions</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={type}
            onChange={(e) => {
              setType(e.target.value)
              setPage(1)
            }}
            className="input w-full sm:w-40"
          >
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <ServerExportButtons
            dataset="transactions"
            title="Transaction ledger"
            params={type ? { type } : {}}
            withRange
          />
        </div>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      <div className="card overflow-hidden">
        {data.rows.length === 0 ? (
          loading ? (
            <p className="px-5 py-8 text-center text-sm text-slate-400">Loading…</p>
          ) : (
            <EmptyState icon={Activity} title="No activity found" description="Nothing has been recorded for this filter yet." />
          )
        ) : (
          <div className={`divide-y divide-slate-100 ${loading ? 'opacity-60' : ''}`}>
            {data.rows.map((txn) => (
              <ActivityRow
                key={txn.id}
                txn={txn}
                item={items.find((i) => i.id === txn.itemId)}
                unit={getUnit(txn.unitId)}
              />
            ))}
          </div>
        )}
      </div>

      <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
    </div>
  )
}
