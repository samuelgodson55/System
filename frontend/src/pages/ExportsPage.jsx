import { useEffect, useMemo, useState } from 'react'
import { Download, FileText, FileJson, Loader2, ShieldCheck } from 'lucide-react'
import { format, subDays, startOfMonth } from 'date-fns'
import { api } from '../utils/api'
import { downloadBlob } from '../utils/export'
import { useAuth } from '../context/AuthContext'
import { useInventory } from '../context/InventoryContext'
import { useSite } from '../context/SiteContext'
import ServerExportButtons from '../components/ServerExportButtons'
import Select from '../components/Select'

const iso = (d) => format(d, 'yyyy-MM-dd')

const SELECTS = {
  type: { label: 'Type', options: [['', 'All'], ['receive', 'Received'], ['issue', 'Issued'], ['return', 'Returned']] },
  status: { label: 'Status', options: [['', 'All'], ['upcoming', 'Upcoming'], ['active', 'Active'], ['completed', 'Completed']] },
  itemType: { label: 'Item type', options: [['', 'All'], ['consumable', 'Consumable'], ['reusable', 'Reusable'], ['kit', 'Kit']] },
  faultStatus: { label: 'Status', options: [['all', 'All'], ['open', 'Open'], ['resolved', 'Resolved']] },
  usability: { label: 'Can be issued?', options: [['', 'All'], ['usable', 'Usable with fault'], ['unusable', 'Out of service']] },
  outType: {
    label: 'Show',
    options: [['expected', 'Expected back (reusable + kits)'], ['consumable', 'Consumables'], ['all', 'Everything']],
  },
}

function Range({ value, onChange, label }) {
  const today = new Date()
  const presets = [
    ['All time', '', ''],
    ['Today', iso(today), iso(today)],
    ['Last 7 days', iso(subDays(today, 6)), iso(today)],
    ['Last 30 days', iso(subDays(today, 29)), iso(today)],
    ['This month', iso(startOfMonth(today)), iso(today)],
  ]
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-slate-500">{label}</p>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {presets.map(([name, from, to]) => {
          const active = value.from === from && value.to === to
          return (
            <button
              key={name}
              type="button"
              onClick={() => onChange({ from, to })}
              className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                active ? 'border-primary-600 bg-primary-50 text-primary-700' : 'border-slate-300 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {name}
            </button>
          )
        })}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input type="date" aria-label="From" className="input" value={value.from} max={value.to || undefined}
          onChange={(e) => onChange({ ...value, from: e.target.value })} />
        <input type="date" aria-label="To" className="input" value={value.to} min={value.from || undefined}
          onChange={(e) => onChange({ ...value, to: e.target.value })} />
      </div>
    </div>
  )
}

function DatasetCard({ ds }) {
  const { categories } = useInventory()
  const [f, setF] = useState({ from: '', to: '', type: '', status: '', itemType: '', outType: 'expected', category: '', search: '', faultStatus: 'all', usability: '' })
  const set = (patch) => setF((p) => ({ ...p, ...patch }))
  const params = {
    from: f.from, to: f.to,
    type: ds.filters.includes('type') ? f.type : '',
    status: ds.filters.includes('status') ? f.status : '',
    itemType: ds.filters.includes('itemType') ? f.itemType : '',
    outType: ds.filters.includes('outType') ? f.outType : '',
    faultStatus: ds.filters.includes('faultStatus') ? f.faultStatus : '',
    usability: ds.filters.includes('usability') ? f.usability : '',
    category: ds.filters.includes('category') ? f.category : '',
    search: ds.filters.includes('search') ? f.search.trim() : '',
  }
  const dateFiltered = ds.filters.includes('range')

  return (
    <div className="card flex flex-col p-5">
      <h3 className="font-semibold text-slate-900">{ds.title}</h3>
      <p className="mt-1 text-sm text-slate-500">{ds.description}</p>

      <div className="mt-4 flex-1 space-y-3 border-t border-slate-100 pt-4">
        {dateFiltered && <Range label={ds.rangeLabel} value={f} onChange={set} />}
        {Object.keys(SELECTS).filter((k) => ds.filters.includes(k)).map((k) => (
          <label key={k} className="block text-xs font-medium text-slate-500">
            {SELECTS[k].label}
            <select className="input mt-1" value={f[k]} onChange={(e) => set({ [k]: e.target.value })}>
              {SELECTS[k].options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
        ))}
        {ds.filters.includes('category') && (
          <label className="block text-xs font-medium text-slate-500">
            Category
            <Select className="input mt-1" value={f.category} onChange={(e) => set({ category: e.target.value })}>
              <option value="">All</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </label>
        )}
        {ds.filters.includes('search') && (
          <label className="block text-xs font-medium text-slate-500">
            Search (optional)
            <input className="input mt-1" value={f.search} placeholder="Name, SKU, person…"
              onChange={(e) => set({ search: e.target.value })} />
          </label>
        )}
        <details className="group text-xs text-slate-400">
          <summary className="cursor-pointer select-none font-medium text-slate-500 hover:text-slate-700">
            Included columns ({ds.columns.length})
          </summary>
          <p className="mt-1 leading-relaxed">{ds.columns.join(', ')}</p>
        </details>
      </div>

      <ServerExportButtons className="mt-4 border-t border-slate-100 pt-4" dataset={ds.id} params={params} title={ds.title} />
    </div>
  )
}

function FullExportCard() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const run = async () => {
    setBusy(true)
    setError('')
    try {
      const { blob, filename } = await api.downloadFullExport()
      downloadBlob(blob, filename || 'full-data.json')
    } catch (e) {
      setError(e.message || 'Export failed')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="card flex flex-col border-primary-200 p-5">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-primary-600" />
        <h3 className="font-semibold text-slate-900">Complete data export (JSON)</h3>
      </div>
      <p className="mt-1 flex-1 text-sm text-slate-500">
        Every table in one file (items, kit pieces, units, events, the full ledger, settings and
        user accounts without passwords), for analysis or moving data elsewhere. This is not a
        restore file; use <strong>Backups</strong> to restore the database.
      </p>
      <div className="mt-4 border-t border-slate-100 pt-4">
        <button type="button" className="btn-secondary" disabled={busy} onClick={run}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileJson className="h-4 w-4" />} Download JSON
        </button>
        {error && <p role="alert" className="mt-1.5 text-xs text-red-600">{error}</p>}
      </div>
    </div>
  )
}

export default function ExportsPage() {
  const { activeSite, isMultiSite } = useSite()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [catalog, setCatalog] = useState(null)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('')

  useEffect(() => {
    api.getExportCatalog().then((r) => setCatalog(r.datasets)).catch((e) => setError(e.message))
  }, [])

  const groups = useMemo(() => {
    const m = new Map()
    for (const d of catalog || []) m.set(d.group, [...(m.get(d.group) || []), d])
    return [...m.entries()]
  }, [catalog])

  const tabs = useMemo(
    () => [
      ...groups.map(([name, list]) => ({ id: name, label: name, count: list.length })),
      ...(isAdmin && catalog ? [{ id: '__admin', label: 'Full data export' }] : []),
    ],
    [groups, isAdmin, catalog]
  )
  const current = tabs.some((t) => t.id === tab) ? tab : tabs[0]?.id

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Reports &amp; Exports</h1>
        <p className="text-sm text-slate-500">
          Download your data as CSV (opens in Excel / Google Sheets, complete, no row limit) or a
          printable PDF. Times use this device&apos;s time zone.
          {isMultiSite && activeSite && (
            <>
              {' '}Reports cover <strong className="font-semibold text-slate-700">{activeSite.name}</strong> only; switch site
              in the header to export another.
            </>
          )}
        </p>
      </div>

      {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {!catalog && !error && <p className="py-12 text-center text-sm text-slate-400">Loading…</p>}

      {tabs.length > 0 && (
        <div role="tablist" aria-label="Report type" className="flex gap-1 overflow-x-auto border-b border-slate-200">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={current === t.id}
              onClick={() => setTab(t.id)}
              className={`-mb-px flex shrink-0 items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                current === t.id ? 'border-primary-600 text-primary-700' : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {t.label}
              {t.count != null && (
                <span className="rounded-full bg-slate-100 px-1.5 text-xs font-normal text-slate-500">{t.count}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {current === '__admin' ? (
        <div className="grid gap-4 md:grid-cols-2"><FullExportCard /></div>
      ) : (
        groups
          .filter(([name]) => name === current)
          .map(([name, list]) => (
            <div key={name} className="grid items-start gap-4 md:grid-cols-2">
              {list.map((ds) => <DatasetCard key={ds.id} ds={ds} />)}
            </div>
          ))
      )}
    </div>
  )
}
