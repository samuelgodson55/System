import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Ban, CheckCircle2, Plus, ShieldCheck } from 'lucide-react'
import { api } from '../utils/api'
import { useAuth } from '../context/AuthContext'
import { refreshFaultSummary } from '../utils/faults'
import SearchBar from '../components/SearchBar'
import Pagination from '../components/Pagination'
import EmptyState from '../components/EmptyState'
import ServerExportButtons from '../components/ServerExportButtons'
import FaultCard from '../components/FaultCard'
import FaultFormModal from '../components/FaultFormModal'
import FaultResolveModal from '../components/FaultResolveModal'

const PAGE = 20

export default function FaultsPage() {
  const { user } = useAuth()
  const [status, setStatus] = useState('open') // open | resolved | all
  const [usability, setUsability] = useState('') // '' | usable | unusable
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState({ faults: [], total: 0, summary: { open: 0, usable: 0, unusable: 0, resolved: 0 } })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ open: false, fault: null })
  const [resolving, setResolving] = useState(null)

  useEffect(() => {
    const t = setTimeout(() => { setDebounced(search.trim()); setPage(1) }, 300)
    return () => clearTimeout(t)
  }, [search])

  const load = useCallback(() => {
    return api
      .getFaults({ status, usability, search: debounced, page, limit: PAGE })
      .then((r) => { setData(r); setError('') })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [status, usability, debounced, page])

  useEffect(() => { setLoading(true); load() }, [load])

  const act = async (fn) => {
    setError('')
    try { await fn(); refreshFaultSummary(); await load() } catch (e) { setError(e.message) }
  }

  const s = data.summary
  const cards = [
    { label: 'Open faults', value: s.open, icon: AlertTriangle, color: 'bg-amber-500', on: () => { setStatus('open'); setUsability(''); setPage(1) } },
    { label: 'Usable with fault', value: s.usable, icon: CheckCircle2, color: 'bg-yellow-500', on: () => { setStatus('open'); setUsability('usable'); setPage(1) } },
    { label: 'Out of service', value: s.unusable, icon: Ban, color: 'bg-red-500', on: () => { setStatus('open'); setUsability('unusable'); setPage(1) } },
    { label: 'Resolved', value: s.resolved, icon: ShieldCheck, color: 'bg-emerald-500', on: () => { setStatus('resolved'); setUsability(''); setPage(1) } },
  ]
  const totalPages = Math.max(1, Math.ceil(data.total / PAGE))

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Faulty Items</h1>
          <p className="text-sm text-slate-500">
            Track items with faults. Items marked <strong>usable with fault</strong> can still be issued; staff see the
            fault and how to use them at issue time.
          </p>
        </div>
        <button className="btn-primary" onClick={() => setForm({ open: true, fault: null })}>
          <Plus className="h-4 w-4" /> Report a fault
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((c) => (
          <button key={c.label} type="button" onClick={c.on} className="card flex items-center gap-4 p-5 text-left transition hover:shadow-md">
            <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${c.color}`}>
              <c.icon className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">{c.value}</p>
              <p className="text-sm text-slate-500">{c.label}</p>
            </div>
          </button>
        ))}
      </div>

      <div className="card">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
          <div className="inline-flex overflow-hidden rounded-lg border border-slate-300 text-sm">
            {[['open', 'Open'], ['resolved', 'Resolved'], ['all', 'All']].map(([v, l]) => (
              <button key={v} type="button" onClick={() => { setStatus(v); setPage(1) }}
                className={`px-3 py-1.5 font-medium ${status === v ? 'bg-primary-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>
                {l}
              </button>
            ))}
          </div>
          <select className="input w-auto" aria-label="Usability" value={usability} onChange={(e) => { setUsability(e.target.value); setPage(1) }}>
            <option value="">Usable &amp; out of service</option>
            <option value="usable">Usable with fault</option>
            <option value="unusable">Out of service</option>
          </select>
          <div className="min-w-[200px] flex-1"><SearchBar value={search} onChange={setSearch} placeholder="Search item, SKU, fault, person…" /></div>
          <ServerExportButtons
            dataset="faults"
            title="Faulty items register"
            withRange
            rangeLabel="Reported between"
            params={{ faultStatus: status, usability, search: debounced }}
          />
        </div>

        <div className="space-y-3 p-4">
          {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          {loading ? (
            <p className="py-10 text-center text-sm text-slate-400">Loading…</p>
          ) : data.faults.length === 0 ? (
            <EmptyState icon={ShieldCheck} title={status === 'open' && !debounced && !usability ? 'No open faults' : 'No faults match these filters'} description={status === 'open' && !debounced && !usability ? 'Everything is in good order.' : undefined} />
          ) : (
            data.faults.map((f) => (
              <FaultCard key={f.id} fault={f} showItem isAdmin={user?.role === 'admin'}
                onEdit={(x) => setForm({ open: true, fault: x })}
                onResolve={setResolving}
                onReopen={(x) => act(() => api.reopenFault(x.id))}
                onDelete={(x) => window.confirm('Delete this fault record permanently?') && act(() => api.deleteFault(x.id))} />
            ))
          )}
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
        </div>
      </div>

      <FaultFormModal open={form.open} fault={form.fault} onClose={() => setForm({ open: false, fault: null })}
        onSaved={() => { load() }} />
      <FaultResolveModal fault={resolving} onClose={() => setResolving(null)} onSaved={() => { load() }} />
    </div>
  )
}
