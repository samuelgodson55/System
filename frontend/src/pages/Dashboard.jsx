import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Package,
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Calendar,
  TrendingDown,
  Wrench,
} from 'lucide-react'
import { useInventory } from '../context/InventoryContext'
import { api } from '../utils/api'
import StatusBadge from '../components/StatusBadge'
import ActivityRow from '../components/ActivityRow'
import Pagination from '../components/Pagination'
import { baseAbbr, fmtQty } from '../utils/units'
import ServerExportButtons from '../components/ServerExportButtons'
import { useFaultSummary } from '../utils/faults'
import { useAuth } from '../context/AuthContext'
import { useSite } from '../context/SiteContext'
import SitesOverview from '../components/SitesOverview'

// rows visible per section on the dashboard
const PAGE_SIZE = 5

export default function Dashboard() {
  const { items, events, units, getUnit } = useInventory()
  const faults = useFaultSummary()
  const { user } = useAuth()
  const { activeSite, isMultiSite } = useSite()
  // Numbers come from the server, so the dashboard stays fast however long the ledger gets.
  // Low stock and recent activity are paged on the server too: only PAGE_SIZE rows are fetched at a time.
  const [stats, setStats] = useState(null)
  const [low, setLow] = useState({ rows: [], total: 0, page: 1 })
  const [activity, setActivity] = useState({ rows: [], total: 0, page: 1 })
  const [lowPage, setLowPage] = useState(1)
  const [activityPage, setActivityPage] = useState(1)
  const [lowLoading, setLowLoading] = useState(true)
  const [activityLoading, setActivityLoading] = useState(true)
  const itemsStamp = `${items.length}:${items.reduce((n, i) => n + Number(i.quantity), 0)}`

  useEffect(() => {
    let live = true
    api
      .getStats()
      .then((st) => live && setStats(st))
      .catch(console.error)
    return () => {
      live = false
    }
  }, [itemsStamp])

  useEffect(() => {
    let live = true
    setLowLoading(true)
    api
      .getItems({ lowStock: 1, page: lowPage, limit: PAGE_SIZE })
      .then((res) => {
        if (!live) return
        const total = res.total || 0
        const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
        // restocking can leave fewer pages than we are on: step back instead of showing an empty page
        if (lowPage > pages) return setLowPage(pages)
        setLow({ rows: res.items || [], total, page: lowPage })
      })
      .catch(console.error)
      .finally(() => live && setLowLoading(false))
    return () => {
      live = false
    }
  }, [itemsStamp, lowPage])

  useEffect(() => {
    let live = true
    setActivityLoading(true)
    api
      .getTransactions({
        topLevel: 1,
        withTotal: 1,
        limit: PAGE_SIZE,
        offset: (activityPage - 1) * PAGE_SIZE,
      })
      .then((res) => {
        if (!live) return
        const total = res.total || 0
        const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
        if (activityPage > pages) return setActivityPage(pages)
        setActivity({ rows: res.transactions || [], total, page: activityPage })
      })
      .catch(console.error)
      .finally(() => live && setActivityLoading(false))
    return () => {
      live = false
    }
  }, [itemsStamp, activityPage])

  const lowPages = Math.max(1, Math.ceil(low.total / PAGE_SIZE))
  const activityPages = Math.max(1, Math.ceil(activity.total / PAGE_SIZE))

  const activeEvents = events.filter((e) => e.status === 'active' || e.status === 'upcoming')

  const stats4 = [
    { label: 'Total SKUs', value: stats?.totalItems ?? items.length, icon: Package, color: 'bg-blue-500' },
    { label: 'Units in Stock', value: (stats?.totalStock ?? 0).toLocaleString(), icon: Package, color: 'bg-primary-500' },
    { label: 'Low Stock Items', value: stats?.lowStockCount ?? low.total, icon: AlertTriangle, color: 'bg-amber-500' },
    { label: 'Transactions', value: stats?.transactionCount ?? 0, icon: TrendingDown, color: 'bg-emerald-500' },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <p className="text-sm text-slate-500">
          Overview of {isMultiSite && activeSite ? <strong className="font-semibold text-slate-700">{activeSite.name}</strong> : 'your inventory'}
        </p>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats4.map((s) => (
          <div key={s.label} className="card flex items-center gap-4 p-5">
            <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${s.color}`}>
              <s.icon className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">{s.value}</p>
              <p className="text-sm text-slate-500">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {user?.role === 'admin' && isMultiSite && <SitesOverview />}

      {faults.open > 0 && (
        <Link to="/faults" className="card flex flex-wrap items-center gap-4 border-amber-200 bg-amber-50 p-4 hover:shadow-md">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500">
            <Wrench className="h-5 w-5 text-white" />
          </div>
          <div className="flex-1">
            <p className="font-semibold text-amber-900">
              {faults.open} open {faults.open === 1 ? 'fault' : 'faults'} across {faults.itemsAffected} {faults.itemsAffected === 1 ? 'item' : 'items'}
            </p>
            <p className="text-sm text-amber-800">
              {faults.unusable} out of service · {faults.usable} usable with fault
            </p>
          </div>
          <span className="text-sm font-medium text-amber-900 underline">View faulty items</span>
        </Link>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Low stock */}
        <div className="card flex flex-col">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <h2 className="font-semibold">Low Stock Alerts</h2>
            <div className="flex items-center gap-3">
              <ServerExportButtons dataset="low-stock" title="Low stock / reorder list" disabled={low.total === 0} />
              <Link to="/inventory?lowStock=1" className="text-sm text-primary-600 hover:underline">
                View all
              </Link>
            </div>
          </div>
          <div className={`divide-y divide-slate-100 ${lowLoading ? 'opacity-60' : ''}`}>
            {low.rows.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-slate-400">
                {lowLoading ? 'Loading…' : 'All items are above reorder level'}
              </p>
            ) : (
              low.rows.map((item) => (
                <Link
                  key={item.id}
                  to={`/inventory/${item.id}`}
                  className="flex items-center justify-between px-5 py-3 hover:bg-slate-50"
                >
                  <div>
                    <p className="text-sm font-medium">{item.name}</p>
                    <p className="text-xs text-slate-400">{item.sku}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-red-600">{fmtQty(item.quantity)} {item.itemType === 'kit' ? 'sets' : baseAbbr(item, units)}</p>
                    <p className="text-xs text-slate-400">Reorder at {item.reorderLevel}</p>
                  </div>
                </Link>
              ))
            )}
          </div>
          {lowPages > 1 && (
            <div className="mt-auto px-5 pb-4">
              <Pagination page={lowPage} totalPages={lowPages} onPageChange={setLowPage} />
            </div>
          )}
        </div>

        {/* Recent transactions */}
        <div className="card flex flex-col">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <h2 className="font-semibold">Recent Activity</h2>
            <div className="flex items-center gap-3">
              <ServerExportButtons dataset="transactions" title="Transaction ledger" withRange />
              <Link to="/activity" className="text-sm text-primary-600 hover:underline">
                View all
              </Link>
            </div>
          </div>
          <div className={`divide-y divide-slate-100 ${activityLoading ? 'opacity-60' : ''}`}>
            {activity.rows.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-slate-400">
                {activityLoading ? 'Loading…' : 'No activity yet'}
              </p>
            ) : (
              activity.rows.map((txn) => (
                <ActivityRow
                  key={txn.id}
                  txn={txn}
                  item={items.find((i) => i.id === txn.itemId)}
                  unit={getUnit(txn.unitId)}
                />
              ))
            )}
          </div>
          {activityPages > 1 && (
            <div className="mt-auto px-5 pb-4">
              <Pagination page={activityPage} totalPages={activityPages} onPageChange={setActivityPage} />
            </div>
          )}
        </div>
      </div>

      {/* Active events */}
      <div className="card">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="font-semibold">Upcoming & Active Events</h2>
          <Link to="/events" className="text-sm text-primary-600 hover:underline">
            Manage events
          </Link>
        </div>
        <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3">
          {activeEvents.length === 0 ? (
            <p className="col-span-full text-center text-sm text-slate-400">No active events</p>
          ) : (
            activeEvents.map((evt) => (
              <div key={evt.id} className="rounded-lg border border-slate-200 p-4">
                <div className="mb-2 flex items-start justify-between">
                  <Calendar className="h-5 w-5 text-primary-500" />
                  <StatusBadge status={evt.status}>{evt.status}</StatusBadge>
                </div>
                <p className="font-medium">{evt.name}</p>
                <p className="mt-1 text-xs text-slate-500">{evt.location}</p>
                <p className="mt-1 text-xs text-slate-400">
                  {evt.startDate} → {evt.endDate}
                </p>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Quick actions */}
      <div className="flex flex-wrap gap-3">
        <Link to="/receive" className="btn-primary">
          <ArrowDownToLine className="h-4 w-4" /> Receive Stock
        </Link>
        <Link to="/issue" className="btn-secondary">
          <ArrowUpFromLine className="h-4 w-4" /> Issue Stock
        </Link>
        <Link to="/inventory" className="btn-secondary">
          <Package className="h-4 w-4" /> View Inventory
        </Link>
      </div>
    </div>
  )
}
