import { useState } from 'react'
import { Plus, Trash2, ClipboardPaste } from 'lucide-react'
import { parseComponentList } from '../utils/kits'

/**
 * Edit the list of pieces that make up ONE set of a kit.
 * value: [{ id?, name, quantityPerKit, notes }]
 */
export default function KitComponentsEditor({ value, onChange, declaredPieces }) {
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')

  const total = value.reduce((n, c) => n + (Number(c.quantityPerKit) || 0), 0)
  const declared = Number(declaredPieces) || 0
  const mismatch = declared > 0 && value.length > 0 && total !== declared

  const update = (idx, patch) => onChange(value.map((c, i) => (i === idx ? { ...c, ...patch } : c)))
  const remove = (idx) => onChange(value.filter((_, i) => i !== idx))
  const add = () => onChange([...value, { name: '', quantityPerKit: 1, notes: '' }])

  const importPasted = () => {
    const parsed = parseComponentList(pasteText)
    if (!parsed.length) return
    const next = [...value]
    for (const p of parsed) {
      const existing = next.findIndex((c) => c.name.trim().toLowerCase() === p.name.toLowerCase())
      if (existing >= 0) {
        next[existing] = { ...next[existing], quantityPerKit: Number(next[existing].quantityPerKit || 0) + p.quantityPerKit }
      } else {
        next.push({ ...p, notes: '' })
      }
    }
    onChange(next)
    setPasteText('')
    setPasteOpen(false)
  }

  return (
    <div className="rounded-lg border border-indigo-100 bg-indigo-50/40 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-slate-800">What is in one set?</p>
          <p className="text-xs text-slate-500">
            List every piece so each one can be issued, returned and traced on its own.
            Leave empty to treat the kit as a single unit.
          </p>
        </div>
        <button
          type="button"
          className="btn-ghost px-2 py-1 text-xs"
          onClick={() => setPasteOpen((o) => !o)}
        >
          <ClipboardPaste className="h-3.5 w-3.5" /> Paste list
        </button>
      </div>

      {pasteOpen && (
        <div className="mb-3 space-y-2 rounded-lg border border-slate-200 bg-white p-3">
          <textarea
            className="input font-mono text-xs"
            rows={5}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={'One piece per line, e.g.\n2 x Flat screwdriver\nPhillips screwdriver x2\nRatchet handle'}
          />
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary px-3 py-1 text-xs" onClick={() => setPasteOpen(false)}>
              Cancel
            </button>
            <button type="button" className="btn-primary px-3 py-1 text-xs" onClick={importPasted}>
              Add to list
            </button>
          </div>
        </div>
      )}

      {value.length > 0 && (
        <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
          <div className="grid grid-cols-[1fr_5rem_1.75rem] gap-2 px-1 text-xs uppercase text-slate-400 sm:grid-cols-[1fr_5rem_9rem_1.75rem]">
            <span>Piece</span>
            <span>Per set</span>
            <span className="hidden sm:block">Notes</span>
            <span />
          </div>
          {value.map((c, idx) => (
            <div
              key={c.id || `new-${idx}`}
              className="grid grid-cols-[1fr_5rem_1.75rem] items-center gap-2 sm:grid-cols-[1fr_5rem_9rem_1.75rem]"
            >
              <input
                className="input py-1.5"
                value={c.name}
                onChange={(e) => update(idx, { name: e.target.value })}
                placeholder="e.g. Flat screwdriver"
                aria-label={`Piece ${idx + 1} name`}
              />
              <input
                type="number"
                min="1"
                step="1"
                className="input py-1.5"
                value={c.quantityPerKit}
                onChange={(e) => update(idx, { quantityPerKit: e.target.value })}
                aria-label={`Quantity of piece ${idx + 1} per set`}
              />
              <input
                className="input hidden py-1.5 sm:block"
                value={c.notes || ''}
                onChange={(e) => update(idx, { notes: e.target.value })}
                placeholder="optional"
                aria-label={`Notes for piece ${idx + 1}`}
              />
              <button
                type="button"
                onClick={() => remove(idx)}
                className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                title="Remove piece"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={add}>
          <Plus className="h-3.5 w-3.5" /> Add piece
        </button>
        {value.length > 0 && (
          <p className={`text-xs ${mismatch ? 'text-amber-700' : 'text-slate-500'}`}>
            {value.length} lines · {total} pieces per set
            {mismatch ? ` (kit says ${declared})` : ''}
          </p>
        )}
      </div>
    </div>
  )
}
