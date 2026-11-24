import { useCallback, useEffect, useRef, useState } from 'react'
import { RotateCcw, User, Package, Wrench, CheckCircle, RefreshCw, Building2, AlertTriangle } from 'lucide-react'
import { api } from '../../utils/api'
import { useAuth } from '../../context/AuthContext'
import SearchBar from '../SearchBar'
import Pagination from '../Pagination'
import ServerExportButtons from '../ServerExportButtons'
import StatusBadge from '../StatusBadge'
import Select from '../Select'
import RecipientEditModal from '../RecipientEditModal'
import { formatDate } from '../../utils/format'
import { plural } from '../../utils/returns'
import OutstandingQuantity from './OutstandingQuantity'
import OutstandingDetailModal from './OutstandingDetailModal'

const PAGE_SIZE = 6
// lines shown per person/item card; the rest open in the detail dialog so a card never grows unbounded
const PREVIEW_LINES = 5
const DAYS = 30

const TYPES = [
  { id: 'expected', label: 'Expected back', hint: 'Reusable items and tool kits' },
  { id: 'consumable', label: 'Consumables', hint: `Issued in the last ${DAYS} days, not yet returned` },
  { id: 'all', label: 'Everything', hint: '' },
]
const GROUPS = [
  { id: 'recipient', label: 'By person' },
  { id: 'item', label: 'By item' },
  { id: 'department', label: 'By department' },
]

function Chips({ options, value, onChange, label }) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-lg bg-slate-100 p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            value === o.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function LineRow({ line, byItem, byDept, onReturn }) {
  const isConsumable = line.itemType === 'consumable'
  const title = byItem ? line.recipient : line.itemName
  const sub = byItem
    ? line.department || 'No department'
    : byDept
      ? `${line.recipient} · ${line.sku}`
      : line.itemType === 'kit' && line.components.length
      ? line.components.slice(0, 3).map((c) => `${c.outstanding} × ${c.name}`).join(', ') +
        (line.components.length > 3 ? ` +${line.components.length - 3} more` : '')
      : line.sku
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-medium">{title}</p>
          {!byItem && isConsumable && <StatusBadge status="consumable">consumable</StatusBadge>}
          {!byItem && line.itemType === 'kit' && <Wrench className="h-3.5 w-3.5 text-indigo-500" aria-label="Tool kit" />}
        </div>
        <p className="truncate text-xs text-slate-400">
          {sub}
          {line.lastIssuedAt ? ` · issued ${formatDate(line.lastIssuedAt)}` : ''}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <div className="text-right"><OutstandingQuantity line={line} /></div>
        <button type="button" className="btn-secondary px-3 py-1.5" onClick={() => onReturn(line)}>
          <RotateCcw className="h-3.5 w-3.5" /> Return
        </button>
      </div>
    </div>
  )
}

/**
 * One screen with everything that is currently out, by person or by item, with a Return
 * button on every line and "Return everything" for a person.
 * `refreshKey` changes whenever a return has been saved, so the list reloads itself.
 */
export default function OutstandingOverview({ onReturn, onReturnAll, refreshKey }) {
  const [type, setType] = useState('expected')
  const [groupBy, setGroupBy] = useState('recipient')
  const [department, setDepartment] = useState('')
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [detailKey, setDetailKey] = useState(null)
  const reqId = useRef(0)
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin' // fixing a person's records (name / department) is admin-only
  const [conflicts, setConflicts] = useState([])
  const [fixing, setFixing] = useState(null)

  useEffect(() => {
    const t = setTimeout(() => { setDebounced(search.trim()); setPage(1) }, 300)
    return () => clearTimeout(t)
  }, [search])

  const load = useCallback(async () => {
    const id = ++reqId.current // ignore answers that arrive after a newer request
    setLoading(true)
    setError('')
    try {
      const res = await api.getOutstandingOverview({
        type, groupBy, search: debounced, days: DAYS, page, limit: PAGE_SIZE,
        ...(department ? { department } : {}),
      })
      if (id !== reqId.current) return
      // a return can empty the last page: step back instead of showing a blank list
      if (res.groups.length === 0 && res.total > 0 && page > 1) return setPage(page - 1)
      setData(res)
    } catch (e) {
      if (id === reqId.current) { setError(e.message || 'Could not load outstanding stock'); setData(null) }
    } finally {
      if (id === reqId.current) setLoading(false)
    }
  }, [type, groupBy, debounced, page, department])

  useEffect(() => { load() }, [load, refreshKey])

  // people whose records sit under more than one department (so their stock shows up split)
  const loadConflicts = useCallback(() => {
    api.getRecipientConflicts().then(setConflicts).catch(() => setConflicts([]))
  }, [])
  useEffect(() => { loadConflicts() }, [loadConflicts, refreshKey])

  const byItem = groupBy === 'item'
  const byDept = groupBy === 'department'
  const departments = data?.departments || []
  const summary = data?.summary
  const pages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1
  const detailGroup = detailKey ? data?.groups.find((g) => g.key === detailKey) : null
  const typeHint = TYPES.find((t) => t.id === type)?.hint

  return (
    <div className="card">
      <div className="space-y-3 border-b border-slate-100 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Chips label="Show" options={TYPES} value={type} onChange={(v) => { setType(v); setPage(1) }} />
          <div className="flex items-center gap-2">
            <Chips label="Group" options={GROUPS} value={groupBy} onChange={(v) => { setGroupBy(v); setPage(1) }} />
            <button type="button" className="btn-ghost px-2 py-1.5" onClick={load} title="Refresh" aria-label="Refresh">
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-slate-400">Export what is listed (all pages)</p>
          <ServerExportButtons
            dataset="outstanding"
            title="Stock currently out"
            params={{ outType: type, search: debounced, days: DAYS, ...(department ? { department } : {}) }}
            disabled={!data || data.total === 0}
          />
        </div>
        <SearchBar value={search} onChange={setSearch} placeholder="Search person, department, item or kit piece…" />
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="out-department" className="text-xs font-medium text-slate-500">Department</label>
          <Select
            id="out-department"
            className="input w-auto min-w-[11rem] py-1.5 text-sm"
            value={department}
            onChange={(e) => { setDepartment(e.target.value); setPage(1) }}
          >
            <option value="">All departments</option>
            {departments.map((d) => (
              <option key={d.name || '__none__'} value={d.name || '__none__'}>
                {(d.name || 'No department')} ({d.people})
              </option>
            ))}
            {department && department !== '__none__' && !departments.some((d) => d.name.toLowerCase() === department.toLowerCase()) && (
              <option value={department}>{department} (0)</option>
            )}
          </Select>
          {department && (
            <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => { setDepartment(''); setPage(1) }}>
              Clear
            </button>
          )}
          {!department && !byDept && departments.length > 0 && (
            <button type="button" className="text-xs text-primary-700 hover:underline" onClick={() => { setGroupBy('department'); setPage(1) }}>
              See stock held by each department
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
          <span>{typeHint}</span>
          {summary && (
            <span aria-live="polite">
              {plural(summary.lines, 'line', 'lines')} · {plural(summary.people, 'person', 'people')} · {plural(summary.items, 'item', 'items')}
            </span>
          )}
        </div>
      </div>

      <div className="space-y-4 p-4">
        {isAdmin && conflicts.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
            <p className="flex items-center gap-1.5 font-medium">
              <AlertTriangle className="h-3.5 w-3.5" />
              {conflicts.length === 1 ? '1 person has' : `${conflicts.length} people have`} records under more than one department
            </p>
            <p className="mt-0.5">Their stock may appear split. Fix it once and everything is merged under one department.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {conflicts.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="rounded-md bg-white px-2 py-1 font-medium text-primary-700 ring-1 ring-amber-200 hover:bg-amber-100"
                  onClick={() => setFixing(c)}
                  title={`Filed under: ${c.ledgerDepartments.join(', ')}`}
                >
                  Fix {c.name} ({c.ledgerDepartments.join(' / ')})
                </button>
              ))}
            </div>
          </div>
        )}
        {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        {type !== 'expected' && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Consumables are normally used up. Only unused ones should be taken back, and only
            what was issued can be returned.
          </p>
        )}

        {!data && loading ? (
          <p className="py-12 text-center text-sm text-slate-400">Loading…</p>
        ) : data && data.groups.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-center">
            <CheckCircle className="mb-2 h-8 w-8 text-emerald-300" />
            <p className="text-sm text-slate-600">
              {debounced ? 'Nothing out matches your search' : 'Nothing is out right now'}
            </p>
            <p className="text-xs text-slate-400">
              {debounced ? 'Try a different name or item.' : 'Everything issued has been returned.'}
            </p>
          </div>
        ) : (
          <div className={`space-y-3 transition-opacity ${loading ? 'opacity-60' : ''}`}>
            {data?.groups.map((g) => {
              const returnable = g.lines.filter((l) => l.itemType !== 'consumable')
              return (
                <section key={g.key} className="overflow-hidden rounded-lg border border-slate-200">
                  <header className="flex items-center justify-between gap-3 bg-slate-50 px-4 py-2.5">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white ring-1 ring-slate-200">
                        {byItem ? <Package className="h-4 w-4 text-indigo-500" /> : byDept ? <Building2 className="h-4 w-4 text-emerald-600" /> : <User className="h-4 w-4 text-slate-500" />}
                      </div>
                      <div className="min-w-0">
                        <button
                          type="button"
                          onClick={() => setDetailKey(g.key)}
                          title="View everything listed"
                          className="block max-w-full truncate text-left text-sm font-semibold hover:text-primary-700 hover:underline focus-visible:underline"
                        >
                          {g.label}
                        </button>
                        <p className="truncate text-xs text-slate-400">
                          {byDept ? '' : byItem ? `${g.sublabel} · ` : g.sublabel ? `${g.sublabel} · ` : ''}
                          {byDept ? `${g.sublabel} · ` : ''}
                          {plural(g.lines.length, byItem ? 'person' : 'item', byItem ? 'people' : 'items')}
                        </p>
                      </div>
                    </div>
                    {!byItem && !byDept && returnable.length > 1 && (
                      <button type="button" className="btn-ghost shrink-0 px-2.5 py-1.5 text-primary-700" onClick={() => onReturnAll(g)}>
                        Return all ({returnable.length})
                      </button>
                    )}
                  </header>
                  <div className="divide-y divide-slate-100">
                    {g.lines.slice(0, PREVIEW_LINES).map((l) => (
                      <LineRow key={`${l.itemId}-${l.recipient}-${l.department}`} line={l} byItem={byItem} byDept={byDept} onReturn={onReturn} />
                    ))}
                  </div>
                  {g.lines.length > PREVIEW_LINES && (
                    <button
                      type="button"
                      onClick={() => setDetailKey(g.key)}
                      className="w-full border-t border-slate-100 bg-slate-50/60 px-4 py-2 text-center text-xs font-medium text-primary-700 hover:bg-slate-50"
                    >
                      View all {g.lines.length} {byItem ? 'people' : 'items'}
                    </button>
                  )}
                </section>
              )
            })}
          </div>
        )}

        <Pagination page={page} totalPages={pages} onPageChange={setPage} />
      </div>

      <RecipientEditModal
        recipient={fixing}
        onClose={() => setFixing(null)}
        onSaved={() => { loadConflicts(); load() }}
      />

      <OutstandingDetailModal
        group={detailGroup}
        byItem={byItem}
        byDept={byDept}
        onClose={() => setDetailKey(null)}
        onReturn={(l, opts) => { setDetailKey(null); onReturn(l, opts) }}
        onReturnAll={(g) => { setDetailKey(null); onReturnAll(g) }}
      />
    </div>
  )
}
