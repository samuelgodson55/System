import { useState, useMemo, useEffect, Fragment } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  Plus, Download, FileText, Package, Pencil, Trash2, ChevronRight, ChevronDown,
  ArrowUpFromLine, ChevronsUpDown, Tags, AlertTriangle,
} from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useInventory } from '../context/InventoryContext'
import SearchBar from '../components/SearchBar'
import Pagination from '../components/Pagination'
import ItemFormModal from '../components/ItemFormModal'
import CategoryManagerModal from '../components/CategoryManagerModal'
import ColumnPicker from '../components/ColumnPicker'
import StatusBadge from '../components/StatusBadge'
import FaultBadge from '../components/FaultBadge'
import EmptyState from '../components/EmptyState'
import { exportToCSV, exportToPDF, filterByDateRange } from '../utils/export'
import ExportDialog from '../components/ExportDialog'
import { inventoryOverview, inventoryFilters } from '../utils/exportSummary'
import { formatDate } from '../utils/format'
import { componentLabel, hasComponents } from '../utils/kits'
import { baseAbbr, usesSystemBase, fmtQty } from '../utils/units'
import Select from '../components/Select'

const PAGE_SIZE = 8

const COLUMNS_STORAGE_KEY = 'inventory_visible_columns'

const qtyCell = (item, value, units = []) => (
  <>
    {fmtQty(value)}
    {item.itemType === 'kit' ? (
      <span className="ml-1 text-xs font-normal text-slate-400">sets</span>
    ) : !usesSystemBase(item, units) ? (
      // items counted in litres, kg ... show it; items counted in pieces look exactly as before
      <span className="ml-1 text-xs font-normal text-slate-400">{baseAbbr(item, units)}</span>
    ) : null}
  </>
)

// Pieces of a kit that are in store but not inside a complete set
const looseNote = (i) =>
  i.itemType === 'kit' && i.loosePieces > 0 ? (
    <span className="block text-xs font-normal text-slate-400">+ {i.loosePieces} loose pcs</span>
  ) : null

// Every column the inventory table can show. `text` is the plain value used for CSV/PDF export.
const COLUMNS = [
  { key: 'sku', label: 'SKU', text: (i) => i.sku,
    td: 'px-4 py-3 font-mono text-xs text-slate-500', render: (i) => i.sku },
  { key: 'name', label: 'Name', locked: true, text: (i) => i.name, td: 'px-4 py-3',
    render: (i, ctx) => (
      <div className="flex items-center gap-1.5">
        {hasComponents(i) ? (
          <button
            type="button"
            onClick={() => ctx.toggle(i.id)}
            className="-ml-1 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-expanded={ctx.isOpen(i)}
            title={ctx.isOpen(i) ? 'Hide contents' : 'Show contents'}
          >
            {ctx.isOpen(i) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        ) : null}
        <Link to={`/inventory/${i.id}`} className="font-medium text-primary-600 hover:underline">
          {i.name}
        </Link>
        <FaultBadge itemId={i.id} />
        {hasComponents(i) && (
          <span className="text-xs text-slate-400">{i.components.length} pieces listed</span>
        )}
      </div>
    ) },
  { key: 'category', label: 'Category', text: (i) => i.category,
    td: 'px-4 py-3 text-slate-600', render: (i) => i.category },
  { key: 'type', label: 'Type', text: (i) => i.itemType || 'consumable', td: 'px-4 py-3',
    render: (i) => (
      <StatusBadge status={i.itemType || 'consumable'}>{i.itemType || 'consumable'}</StatusBadge>
    ) },
  { key: 'available', label: 'Available Qty', right: true, text: (i) => i.quantity,
    td: 'px-4 py-3 text-right font-medium tabular-nums',
    render: (i, ctx) => (<>{qtyCell(i, i.quantity, ctx.units)}{looseNote(i)}</>) },
  { key: 'outstanding', label: 'Issued Out', right: true, text: (i) => i.outstanding ?? 0,
    td: 'px-4 py-3 text-right tabular-nums text-slate-600',
    render: (i, ctx) => (
      <>
        {qtyCell(i, i.outstanding ?? 0, ctx.units)}
        {i.itemType === 'kit' && i.piecesOut > 0 ? (
          <span className="block text-xs font-normal text-slate-400">{i.piecesOut} pcs out</span>
        ) : null}
      </>
    ) },
  { key: 'total', label: 'Total Qty', right: true, text: (i) => i.totalQuantity ?? i.quantity,
    td: 'px-4 py-3 text-right font-medium tabular-nums', render: (i, ctx) => qtyCell(i, i.totalQuantity ?? i.quantity, ctx.units) },
  { key: 'status', label: 'Status', text: (i) => (i.quantity <= i.reorderLevel ? 'Low' : 'OK'),
    td: 'px-4 py-3',
    render: (i) =>
      i.quantity <= i.reorderLevel ? (
        <StatusBadge status="low">Low</StatusBadge>
      ) : (
        <StatusBadge status="ok">OK</StatusBadge>
      ) },
  { key: 'reorderLevel', label: 'Reorder Level', right: true, text: (i) => i.reorderLevel,
    td: 'px-4 py-3 text-right tabular-nums text-slate-600', render: (i) => i.reorderLevel },
  { key: 'location', label: 'Location', text: (i) => i.location,
    td: 'px-4 py-3 text-slate-500', render: (i) => i.location },
  { key: 'updated', label: 'Last Updated', text: (i) => formatDate(i.updatedAt),
    td: 'px-4 py-3 text-slate-500', render: (i) => formatDate(i.updatedAt) },
]

const DEFAULT_COLUMNS = ['sku', 'name', 'category', 'type', 'available', 'status', 'location']

// How each column is filled for a kit's component row (one piece of a kit).
// Pieces are counted in pieces, not sets; they inherit category and location from the kit.
const COMPONENT_CELLS = {
  sku: () => '',
  name: (c, kit) => componentLabel(c, kit),
  category: (_c, kit) => kit.category,
  type: () => 'component',
  available: (c) => c.available,
  outstanding: (c) => c.outstanding,
  total: (c) => c.available + c.outstanding,
  status: () => '',
  reorderLevel: () => '',
  location: (_c, kit) => kit.location,
  updated: () => '',
}

const componentText = (key, c, kit) => COMPONENT_CELLS[key]?.(c, kit) ?? ''

function renderComponentCell(col, c, kit) {
  const v = componentText(col.key, c, kit)
  if (col.key === 'type') return <StatusBadge status="component">piece</StatusBadge>
  if (col.key === 'name') {
    return (
      <span className="pl-6 text-slate-700">
        <span className="mr-1 text-slate-300">↳</span>
        {v}
        {c.quantityPerKit > 1 && (
          <span className="ml-1.5 text-xs text-slate-400">{c.quantityPerKit} per set</span>
        )}
      </span>
    )
  }
  if (col.key === 'available' || col.key === 'outstanding' || col.key === 'total') {
    return (
      <>
        {v}
        <span className="ml-1 text-xs font-normal text-slate-400">pcs</span>
      </>
    )
  }
  return v
}

function loadVisibleColumns() {
  try {
    const saved = JSON.parse(localStorage.getItem(COLUMNS_STORAGE_KEY))
    if (Array.isArray(saved)) {
      const valid = saved.filter((k) => COLUMNS.some((c) => c.key === k))
      if (valid.length) return valid
    }
  } catch {
    /* ignore corrupt or unavailable storage */
  }
  return DEFAULT_COLUMNS
}

export default function InventoryList() {
  const { items, units, categories, deleteItem } = useInventory()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [categoryFilter, setCategoryFilter] = useState('')
  const [managingCategories, setManagingCategories] = useState(false)

  // a category filter that was renamed / merged away would otherwise show an empty list
  useEffect(() => {
    if (categoryFilter && !categories.some((c) => c.toLowerCase() === categoryFilter.toLowerCase())) {
      setCategoryFilter('')
    }
  }, [categories, categoryFilter])
  const [typeFilter, setTypeFilter] = useState('')
  // "Low stock only" lives in the URL (?lowStock=1) so the dashboard's "View all" can link straight to it
  const [searchParams, setSearchParams] = useSearchParams()
  const lowOnly = ['1', 'true'].includes(searchParams.get('lowStock') || '')
  const setLowOnly = (on) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        on ? next.set('lowStock', '1') : next.delete('lowStock')
        return next
      },
      { replace: true }
    )
    setPage(1)
  }
  const [exportFmt, setExportFmt] = useState(null) // 'csv' | 'pdf' | null
  const [visibleCols, setVisibleCols] = useState(loadVisibleColumns)
  const [openKits, setOpenKits] = useState(() => new Set())

  useEffect(() => {
    try {
      localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(visibleCols))
    } catch {
      /* storage unavailable — choice just won't persist */
    }
  }, [visibleCols])

  // Name is always shown; keep table order stable regardless of tick order
  const shownColumns = COLUMNS.filter((c) => c.locked || visibleCols.includes(c.key))

  const q = search.trim().toLowerCase()
  // Every word typed must match (so "precision 80" finds "Precision Screwdriver Set (80-in-1)")
  const tokens = useMemo(() => q.split(/\s+/).filter(Boolean), [q])
  const hasAll = (text) => {
    const t = String(text || '').toLowerCase()
    return tokens.every((w) => t.includes(w))
  }

  // The item itself matches (name, SKU, category or location)
  const ownMatch = (item) =>
    tokens.length > 0 &&
    hasAll([item.name, item.sku, item.category, item.location].filter(Boolean).join(' '))

  // Pieces inside a kit that match. A kit that matched on its own is never expanded by the
  // search: typing a kit's name shows that kit, not every piece inside it. Only when the kit
  // is listed *because of* a piece do we open it, and then only that piece(s) are shown.
  const matchingPieces = (item) =>
    tokens.length && hasComponents(item) && !ownMatch(item)
      ? item.components.filter((c) => hasAll(c.name))
      : []

  const filtered = useMemo(() => {
    let list = items
    if (tokens.length) {
      const own = new Map(list.map((i) => [i.id, ownMatch(i)]))
      list = list.filter(
        (i) => own.get(i.id) || (hasComponents(i) && i.components.some((c) => hasAll(c.name)))
      )
      // items that match directly come before kits listed only because of a piece inside
      list = [...list].sort((a, b) => Number(own.get(b.id)) - Number(own.get(a.id)))
    }
    if (categoryFilter) {
      const cf = categoryFilter.toLowerCase()
      list = list.filter((i) => (i.category || '').trim().toLowerCase() === cf)
    }
    if (typeFilter) list = list.filter((i) => (i.itemType || 'consumable') === typeFilter)
    // same rule the server uses for the dashboard's low-stock list
    if (lowOnly) list = list.filter((i) => Number(i.quantity) <= Number(i.reorderLevel))
    return list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, tokens, categoryFilter, typeFilter, lowOnly])

  const kitsWithParts = filtered.filter(hasComponents)
  const allOpen = kitsWithParts.length > 0 && kitsWithParts.every((k) => openKits.has(k.id))
  const toggleKit = (id) =>
    setOpenKits((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  const toggleAll = () => setOpenKits(allOpen ? new Set() : new Set(kitsWithParts.map((k) => k.id)))
  // A kit is open when expanded by hand, or when the search matched one of its pieces
  const isOpen = (item) => openKits.has(item.id) || matchingPieces(item).length > 0
  const rowCtx = { toggle: toggleKit, isOpen, units }

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  // keep the page valid when deleting/filtering leaves fewer pages
  useEffect(() => {
    if (page > 1 && page > totalPages) setPage(Math.max(1, totalPages))
  }, [page, totalPages])
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const openCreate = () => {
    setEditing(null)
    setModalOpen(true)
  }

  const openEdit = (item) => {
    if (!isAdmin) return // editing is admin-only (the server enforces this too)
    setEditing(item)
    setModalOpen(true)
  }

  const handleDelete = async (id) => {
    if (!isAdmin) return
    if (window.confirm('Delete this item AND its whole stock history? This cannot be undone.')) {
      try {
        await deleteItem(id)
      } catch (err) {
        alert(err.message || 'Could not delete the item')
      }
    }
  }

  // Export what's on screen: same columns as the table, plus the optional date range (on last-updated)
  const exportItems = (exportFrom, exportTo) =>
    filterByDateRange(filtered, 'updatedAt', exportFrom, exportTo)

  // Kits are followed by one row per piece so the export shows what is inside each kit
  const exportRows = (exportFrom, exportTo) =>
    exportItems(exportFrom, exportTo).flatMap((i) => [
      { cells: shownColumns.map((c) => c.text(i)), kind: hasComponents(i) ? 'group' : 'item' },
      ...(hasComponents(i)
        ? i.components.map((comp) => ({
            cells: shownColumns.map((c) => componentText(c.key, comp, i)),
            kind: 'child',
          }))
        : []),
    ])

  // Overview shown at the top of every inventory export: headline counts + the filters that produced the list
  const exportMeta = (exportFrom, exportTo) => ({
    title: 'Inventory Report',
    summary: inventoryOverview(exportItems(exportFrom, exportTo)),
    filters: inventoryFilters({ search: search.trim(), category: categoryFilter, type: typeFilter, lowOnly }),
  })

  const handleExportCSV = (exportFrom, exportTo) => {
    const data = exportRows(exportFrom, exportTo).map(({ cells }) =>
      Object.fromEntries(shownColumns.map((c, idx) => [c.label, cells[idx]]))
    )
    if (data.length === 0) return 'No items match the selected date range (filtered on last updated).'
    exportToCSV(data, 'inventory', {
      fromDate: exportFrom,
      toDate: exportTo,
      prefiltered: true,
      ...exportMeta(exportFrom, exportTo),
    })
  }

  const handleExportPDF = (exportFrom, exportTo) => {
    const rows = exportRows(exportFrom, exportTo).map(({ cells }) => cells)
    if (rows.length === 0) return 'No items match the selected date range (filtered on last updated).'
    // kits are bold group rows with their pieces underneath
    const rowKinds = exportRows(exportFrom, exportTo).map((_, idx, all) => all[idx].kind)
    exportToPDF('Inventory Report', shownColumns.map((c) => c.label), rows, 'inventory', {
      fromDate: exportFrom,
      toDate: exportTo,
      rowKinds,
      ...exportMeta(exportFrom, exportTo),
    })
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Inventory</h1>
          <p className="text-sm text-slate-500">{filtered.length} items</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {kitsWithParts.length > 0 && (
            <button onClick={toggleAll} className="btn-secondary" title="Show or hide the pieces inside kits">
              <ChevronsUpDown className="h-4 w-4" /> {allOpen ? 'Collapse kits' : 'Expand kits'}
            </button>
          )}
          {isAdmin && (
            <button onClick={() => setManagingCategories(true)} className="btn-secondary" title="Rename, merge or add categories">
              <Tags className="h-4 w-4" /> Categories
            </button>
          )}
          <ColumnPicker
            columns={COLUMNS}
            visible={visibleCols}
            onChange={setVisibleCols}
            onReset={() => setVisibleCols(DEFAULT_COLUMNS)}
          />
          <button onClick={() => setExportFmt('csv')} className="btn-secondary">
            <Download className="h-4 w-4" /> CSV
          </button>
          <button onClick={() => setExportFmt('pdf')} className="btn-secondary">
            <FileText className="h-4 w-4" /> PDF
          </button>
          <button onClick={openCreate} className="btn-primary">
            <Plus className="h-4 w-4" /> Add Item
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="flex-1">
            <SearchBar
              value={search}
              onChange={(v) => {
                setSearch(v)
                setPage(1)
              }}
              placeholder="Search by name, SKU, category, location…"
            />
          </div>
          <Select
            value={categoryFilter}
            onChange={(e) => {
              setCategoryFilter(e.target.value)
              setPage(1)
            }}
            className="input w-full sm:w-40"
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
          <select
            value={typeFilter}
            onChange={(e) => {
              setTypeFilter(e.target.value)
              setPage(1)
            }}
            className="input w-full sm:w-36"
          >
            <option value="">All types</option>
            <option value="consumable">Consumable</option>
            <option value="reusable">Reusable</option>
            <option value="kit">Kit / Tool set</option>
          </select>
          <button
            type="button"
            onClick={() => setLowOnly(!lowOnly)}
            aria-pressed={lowOnly}
            title="Show only items at or below their reorder level"
            className={`inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium ${
              lowOnly
                ? 'border-amber-300 bg-amber-50 text-amber-800'
                : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            <AlertTriangle className="h-4 w-4" /> Low stock only
          </button>
        </div>
      </div>

      <div className="card overflow-hidden">
        {paged.length === 0 ? (
          <EmptyState
            icon={Package}
            title="No items found"
            description="Try adjusting your search or add a new item."
            action={
              <button onClick={openCreate} className="btn-primary">
                <Plus className="h-4 w-4" /> Add Item
              </button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  {shownColumns.map((c) => (
                    <th
                      key={c.key}
                      className={`px-4 py-3 font-medium ${c.right ? 'text-right' : ''}`}
                    >
                      {c.label}
                    </th>
                  ))}
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paged.map((item) => (
                  <Fragment key={item.id}>
                  <tr className="hover:bg-slate-50">
                    {shownColumns.map((c) => (
                      <td key={c.key} className={c.td}>
                        {c.render(item, rowCtx)}
                      </td>
                    ))}
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <Link
                          to={`/issue?item=${item.id}`}
                          className="rounded p-1.5 text-slate-400 hover:bg-amber-50 hover:text-amber-600"
                          title={hasComponents(item) ? 'Issue (whole kit or pieces)' : 'Issue'}
                        >
                          <ArrowUpFromLine className="h-4 w-4" />
                        </Link>
                        {isAdmin && (
                          <>
                            <button
                              onClick={() => openEdit(item)}
                              className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                              title="Edit"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => handleDelete(item.id)}
                              className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                              title="Delete"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                  {hasComponents(item) && isOpen(item) &&
                    // opened by hand: all pieces; opened by the search: only the matching ones
                    (openKits.has(item.id) ? item.components : matchingPieces(item)).map((comp) => {
                      const hit = tokens.length > 0 && !ownMatch(item) && hasAll(comp.name)
                      return (
                        <tr
                          key={comp.id}
                          className={`text-slate-600 ${hit ? 'bg-amber-50/60' : 'bg-slate-50/60'} hover:bg-slate-100/70`}
                        >
                          {shownColumns.map((c) => (
                            <td
                              key={c.key}
                              className={c.td.replace('py-3', 'py-2')}
                            >
                              {renderComponentCell(c, comp, item)}
                            </td>
                          ))}
                          <td className="px-4 py-2">
                            <div className="flex justify-end">
                              <Link
                                to={`/issue?item=${item.id}&component=${comp.id}`}
                                className="rounded p-1.5 text-slate-400 hover:bg-amber-50 hover:text-amber-600"
                                title={`Issue ${componentLabel(comp, item)}`}
                              >
                                <ArrowUpFromLine className="h-4 w-4" />
                              </Link>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="px-4 py-3">
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
        </div>
      </div>

      <CategoryManagerModal
        open={isAdmin && managingCategories}
        onClose={() => setManagingCategories(false)}
        onRenamed={(from, to) =>
          setCategoryFilter((f) => (f && f.toLowerCase() === from.toLowerCase() ? to : f))
        }
      />
      <ItemFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        item={editing}
      />
      <ExportDialog
        format={exportFmt}
        title="Export inventory"
        onClose={() => setExportFmt(null)}
        onConfirm={(from, to) => (exportFmt === 'csv' ? handleExportCSV(from, to) : handleExportPDF(from, to))}
      />
    </div>
  )
}
