import { useEffect, useRef, useState } from 'react'
import { Columns3, RotateCcw } from 'lucide-react'

/**
 * Dropdown of checkboxes for choosing which table columns are shown.
 * columns: [{ key, label, locked? }]  — locked columns are always on.
 */
export default function ColumnPicker({ columns, visible, onChange, onReset, onSelectAll }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const toggle = (key) => {
    onChange(visible.includes(key) ? visible.filter((k) => k !== key) : [...visible, key])
  }

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="btn-secondary">
        <Columns3 className="h-4 w-4" /> Columns
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-56 rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
          <p className="px-2 pb-1 pt-0.5 text-xs font-medium uppercase text-slate-400">
            Show columns
          </p>
          <ul className="max-h-72 overflow-y-auto">
            {columns.map((c) => (
              <li key={c.key}>
                <label
                  className={`flex items-center gap-2 rounded px-2 py-1.5 text-sm ${
                    c.locked ? 'text-slate-400' : 'cursor-pointer hover:bg-slate-50'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={c.locked || visible.includes(c.key)}
                    disabled={c.locked}
                    onChange={() => toggle(c.key)}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  {c.label}
                </label>
              </li>
            ))}
          </ul>
          <div className="mt-1 flex items-center justify-between gap-2 border-t border-slate-100 px-2 pt-2">
            <button type="button" onClick={onReset} className="flex items-center gap-1.5 text-xs text-primary-600 hover:underline">
              <RotateCcw className="h-3 w-3" /> Reset to default
            </button>
            {onSelectAll && (
              <button type="button" onClick={onSelectAll} className="text-xs text-primary-600 hover:underline">
                Select all
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
