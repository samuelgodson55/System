import { useCallback, useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { AlertTriangle, Plus } from 'lucide-react'
import { api } from '../utils/api'
import { useAuth } from '../context/AuthContext'
import { refreshFaultSummary } from '../utils/faults'
import FaultCard from './FaultCard'
import FaultFormModal from './FaultFormModal'
import FaultResolveModal from './FaultResolveModal'

/** Faults of one item (open first, resolved history below) with report / edit / resolve. */
export default function ItemFaultsPanel({ item }) {
  const { user } = useAuth()
  const { hash } = useLocation()
  const [faults, setFaults] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ open: false, fault: null })
  const [resolving, setResolving] = useState(null)
  const [showResolved, setShowResolved] = useState(false)

  const load = useCallback(() => {
    return api
      .getFaults({ itemId: item.id, status: 'all', limit: 200 })
      .then((r) => { setFaults(r.faults); setError('') })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [item.id])

  useEffect(() => { setLoading(true); load() }, [load])

  // arriving from a "n faults" badge (#faults): scroll the panel into view once loaded
  useEffect(() => {
    if (!loading && hash === '#faults') document.getElementById('faults')?.scrollIntoView({ behavior: 'smooth' })
  }, [loading, hash])

  const open = faults.filter((f) => f.status === 'open')
  const resolved = faults.filter((f) => f.status === 'resolved')

  const act = async (fn) => {
    setError('')
    try { await fn(); refreshFaultSummary(); await load() } catch (e) { setError(e.message) }
  }

  return (
    <div id="faults" className="card scroll-mt-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className={`h-5 w-5 ${open.length ? 'text-amber-500' : 'text-slate-300'}`} />
          <h2 className="font-semibold">Faults</h2>
          {open.length > 0 && <span className="badge bg-amber-100 text-amber-800">{open.length} open</span>}
        </div>
        <button className="btn-secondary text-xs" onClick={() => setForm({ open: true, fault: null })}>
          <Plus className="h-3.5 w-3.5" /> Report a fault
        </button>
      </div>
      <div className="space-y-3 p-5">
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        {loading ? (
          <p className="text-sm text-slate-400">Loading…</p>
        ) : open.length === 0 ? (
          <p className="text-sm text-slate-400">No open faults on this item.</p>
        ) : (
          open.map((f) => (
            <FaultCard key={f.id} fault={f} isAdmin={user?.role === 'admin'}
              onEdit={(x) => setForm({ open: true, fault: x })}
              onResolve={setResolving}
              onDelete={(x) => window.confirm('Delete this fault record permanently?') && act(() => api.deleteFault(x.id))} />
          ))
        )}
        {resolved.length > 0 && (
          <>
            <button className="text-sm text-primary-600 hover:underline" onClick={() => setShowResolved((v) => !v)}>
              {showResolved ? 'Hide' : 'Show'} resolved history ({resolved.length})
            </button>
            {showResolved && resolved.map((f) => (
              <FaultCard key={f.id} fault={f} isAdmin={user?.role === 'admin'}
                onReopen={(x) => act(() => api.reopenFault(x.id))}
                onDelete={(x) => window.confirm('Delete this fault record permanently?') && act(() => api.deleteFault(x.id))} />
            ))}
          </>
        )}
      </div>
      <FaultFormModal open={form.open} item={item} fault={form.fault} onClose={() => setForm({ open: false, fault: null })} onSaved={load} />
      <FaultResolveModal fault={resolving} onClose={() => setResolving(null)} onSaved={load} />
    </div>
  )
}
