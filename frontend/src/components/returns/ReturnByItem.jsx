import { useState, useEffect, useCallback, useMemo } from 'react'
import { User, Package, ChevronRight, Wrench } from 'lucide-react'
import { useInventory } from '../../context/InventoryContext'
import { api } from '../../utils/api'
import SearchBar from '../SearchBar'
import Pagination from '../Pagination'
import StatusBadge from '../StatusBadge'
import { hasComponents } from '../../utils/kits'
import { baseUnitLabel, piecesOut, plural } from '../../utils/returns'
import { formatDate } from '../../utils/format'

const PAGE_SIZE = 8
const FILTERS = [
  { id: '', label: 'All' },
  { id: 'reusable', label: 'Reusable' },
  { id: 'kit', label: 'Kits' },
  { id: 'consumable', label: 'Consumables' },
]

/**
 * Look up one item and see who has it. Works for every item type; consumables list who was
 * issued some (most recent first), since they are not "expected back" like reusables.
 */
export default function ReturnByItem({ onReturn, refreshKey }) {
  const { items, units } = useInventory()
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [selectedId, setSelectedId] = useState(null)

  const [balances, setBalances] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [balSearch, setBalSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const selected = items.find((i) => i.id === selectedId) || null
  const isKit = hasComponents(selected)
  const isConsumable = selected?.itemType === 'consumable'

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter(
      (i) =>
        (!typeFilter || i.itemType === typeFilter) &&
        (!q || i.name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q))
    )
  }, [items, search, typeFilter])

  const load = useCallback(async () => {
    if (!selectedId) return
    setLoading(true)
    setError('')
    try {
      const data = await api.getOutstanding(selectedId, { search: balSearch, page, limit: PAGE_SIZE })
      setBalances(data.balances || [])
      setTotal(data.total || 0)
    } catch (e) {
      setError(e.message)
      setBalances([])
      setTotal(0)
    } finally {
      setLoading(false)
    }
  }, [selectedId, balSearch, page])

  useEffect(() => { load() }, [load, refreshKey])

  const choose = (item) => {
    setSelectedId(item.id)
    setPage(1)
    setBalSearch('')
    setError('')
  }

  if (!selected) {
    return (
      <div className="card p-5">
        <label className="mb-2 block text-sm font-medium">Select item to return</label>
        <SearchBar value={search} onChange={setSearch} placeholder="Search items or kits…" />
        <div className="mt-3 flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={typeFilter === f.id}
              onClick={() => setTypeFilter(f.id)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                typeFilter === f.id ? 'bg-primary-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="mt-3 max-h-96 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
          {filtered.map((item) => (
            <button
              key={item.id}
              onClick={() => choose(item)}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium">{item.name}</p>
                  <StatusBadge status={item.itemType}>{item.itemType}</StatusBadge>
                  {item.itemType === 'kit' && item.piecesPerSet && (
                    <span className="inline-flex items-center gap-1 text-xs text-indigo-600">
                      <Wrench className="h-3 w-3" /> {item.piecesPerSet}-piece set
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-400">{item.sku}</p>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="px-4 py-10 text-center text-sm text-slate-400">No items found</p>
          )}
        </div>
      </div>
    )
  }

  const unitName = baseUnitLabel(selected, units)
  return (
    <div className="space-y-4">
      <div className="card flex items-center justify-between gap-3 p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50">
            <Package className="h-5 w-5 text-indigo-600" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium">{selected.name}</p>
              <StatusBadge status={selected.itemType}>{selected.itemType}</StatusBadge>
            </div>
            <p className="text-xs text-slate-400">
              {selected.sku}
              {selected.itemType === 'kit' && selected.piecesPerSet ? ` · ${selected.piecesPerSet} pieces per set` : ''}
            </p>
          </div>
        </div>
        <button type="button" onClick={() => { setSelectedId(null); setBalances([]) }} className="text-sm text-primary-600 hover:underline">
          Change item
        </button>
      </div>

      <div className="card">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="font-semibold">{isConsumable ? 'Who was issued this item?' : 'Who is returning this item?'}</h2>
          <p className="text-xs text-slate-400">
            {isConsumable
              ? 'Consumables are normally used up – only unused ones should come back. Most recent first.'
              : 'People with outstanding quantity for this item'}
          </p>
        </div>
        <div className="space-y-3 p-4">
          <SearchBar value={balSearch} onChange={(v) => { setBalSearch(v); setPage(1) }} placeholder="Search recipient or department…" />
          {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

          {loading && balances.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-400">Loading…</p>
          ) : balances.length === 0 ? (
            <div className="flex flex-col items-center py-12 text-center">
              <User className="mb-2 h-8 w-8 text-slate-300" />
              <p className="text-sm text-slate-500">
                {isConsumable ? 'Nothing issued that can still be returned' : 'No outstanding issues for this item'}
              </p>
              <p className="text-xs text-slate-400">
                {isConsumable ? 'It has not been issued, or it has all been returned.' : 'Everyone has returned what they borrowed, or nothing was issued yet.'}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200">
              {balances.map((bal) => (
                <button
                  key={`${bal.recipient}-${bal.department}`}
                  onClick={() => onReturn({ item: selected, balance: bal })}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left transition-colors hover:bg-sky-50"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100">
                      <User className="h-4 w-4 text-slate-500" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{bal.recipient}</p>
                      <p className="text-xs text-slate-400">
                        {bal.department || 'No department'}
                        {bal.lastIssuedAt ? ` · issued ${formatDate(bal.lastIssuedAt)}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <div className="text-right">
                      {isKit ? (
                        <>
                          <p className="text-sm font-semibold tabular-nums text-amber-700">{plural(bal.outstanding, 'set', 'sets')}</p>
                          <p className="text-xs text-slate-400">{plural(piecesOut(bal), 'piece', 'pieces')} out</p>
                        </>
                      ) : (
                        <>
                          <p className="text-sm font-semibold tabular-nums text-amber-700">{bal.outstanding} {selected.itemType === 'kit' ? 'sets' : unitName}</p>
                          <p className="text-xs text-slate-400">{isConsumable ? 'issued' : 'outstanding'}</p>
                        </>
                      )}
                    </div>
                    <ChevronRight className="h-4 w-4 text-slate-300" />
                  </div>
                </button>
              ))}
            </div>
          )}
          <Pagination page={page} totalPages={Math.max(1, Math.ceil(total / PAGE_SIZE))} onPageChange={setPage} />
        </div>
      </div>
    </div>
  )
}
