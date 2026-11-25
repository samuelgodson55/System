import { useEffect, useState } from 'react'
import { Store, ArrowRightLeft } from 'lucide-react'
import { api } from '../utils/api'
import { useSite } from '../context/SiteContext'

/** Admin dashboard card: the headline numbers of every site side by side, with a one-click switch. */
export default function SitesOverview() {
  const { activeSiteId, switchSite } = useSite()
  const [rows, setRows] = useState(null)

  useEffect(() => {
    let live = true
    api
      .getSitesOverview()
      .then((r) => live && setRows(r))
      .catch(() => live && setRows([]))
    return () => {
      live = false
    }
  }, [])

  if (!rows || rows.length < 2) return null
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-slate-200 px-5 py-3">
        <Store className="h-5 w-5 text-primary-600" />
        <h2 className="font-semibold text-slate-900">All sites</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2.5 font-medium">Site</th>
              <th className="px-4 py-2.5 text-right font-medium">Items</th>
              <th className="px-4 py-2.5 text-right font-medium">Low stock</th>
              <th className="px-4 py-2.5 text-right font-medium">Open faults</th>
              <th className="px-4 py-2.5 text-right font-medium">Live events</th>
              <th className="px-4 py-2.5 text-right font-medium">Movements (30 d)</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.id} className={r.id === activeSiteId ? 'bg-primary-50/50' : 'hover:bg-slate-50'}>
                <td className="px-4 py-2.5 font-medium text-slate-800">
                  {r.name}
                  {!r.isActive && <span className="ml-2 text-xs font-normal text-slate-400">deactivated</span>}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">{r.itemCount}</td>
                <td className={`px-4 py-2.5 text-right tabular-nums ${r.lowStockCount ? 'font-semibold text-amber-600' : ''}`}>{r.lowStockCount}</td>
                <td className={`px-4 py-2.5 text-right tabular-nums ${r.openFaults ? 'font-semibold text-red-600' : ''}`}>{r.openFaults}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{r.activeEvents}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{r.movements30d}</td>
                <td className="px-4 py-2.5 text-right">
                  {r.id === activeSiteId ? (
                    <span className="text-xs font-medium text-primary-700">Viewing</span>
                  ) : (
                    <button
                      className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-primary-700 hover:bg-primary-50"
                      onClick={() => switchSite(r.id)}
                    >
                      <ArrowRightLeft className="h-3.5 w-3.5" /> Switch
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
