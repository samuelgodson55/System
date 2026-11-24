import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Pencil, Plus, UserCheck } from 'lucide-react'
import useAnchoredMenu from '../hooks/useAnchoredMenu'

const MAX_SHOWN = 50
const same = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase()

/**
 * Recipient picker: a searchable drop-down of saved recipients. Type to filter; choose one to
 * re-use it (their usual department is offered), or keep typing a name that is not on the list
 * to add a new recipient – it is saved when the issue is confirmed.
 *
 *  value        current text (the recipient's name)
 *  onChange     (name) – every keystroke / pick
 *  onPick       (recipient, { explicit }) – a saved recipient was chosen (explicit = from the list)
 *  onEdit       (recipient) – "Edit" next to a saved recipient
 */
export default function RecipientCombobox({
  value,
  onChange,
  recipients = [],
  onPick,
  onEdit,
  required = true,
  placeholder = 'Choose a recipient or type a new name',
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const wrap = useRef(null)
  const field = useRef(null)
  const menu = useRef(null)
  const listId = useId()
  const menuStyle = useAnchoredMenu(field, open, { maxHeight: 256 })
  const text = value || ''
  const exact = useMemo(() => (text.trim() ? recipients.find((r) => same(r.name, text)) : null), [recipients, text])

  const filtered = useMemo(() => {
    const q = text.trim().toLowerCase()
    const list = q
      ? recipients.filter((r) => r.name.toLowerCase().includes(q) || (r.department || '').toLowerCase().includes(q))
      : recipients
    return list.slice(0, MAX_SHOWN)
  }, [recipients, text])

  const total = filtered.length
  const showNew = text.trim() && !exact
  const rows = showNew ? [...filtered, { __new: true }] : filtered

  useEffect(() => setActive(0), [text])

  // close when clicking anywhere outside
  useEffect(() => {
    if (!open) return
    const away = (e) => {
      if (wrap.current?.contains(e.target) || menu.current?.contains(e.target)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])

  const choose = (row) => {
    if (row.__new) {
      onChange(text.trim().replace(/\s+/g, ' '))
    } else {
      onChange(row.name)
      onPick?.(row, { explicit: true })
    }
    setOpen(false)
  }

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setOpen(true)
      setActive((a) => Math.min(rows.length - 1, a + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(0, a - 1))
    } else if (e.key === 'Enter' && open && rows[active]) {
      e.preventDefault() // choosing from the list must not submit the form
      choose(rows[active])
    } else if (e.key === 'Escape' && open) {
      e.stopPropagation()
      setOpen(false)
    }
  }

  const handleBlur = () => {
    // typed an existing name in other capitalisation: snap to the saved spelling
    if (exact && exact.name !== text) {
      onChange(exact.name)
      onPick?.(exact, { explicit: false })
    } else if (exact) {
      onPick?.(exact, { explicit: false })
    } else if (text !== text.trim()) {
      onChange(text.trim().replace(/\s+/g, ' '))
    }
  }

  return (
    <div ref={wrap} className="relative">
      <div ref={field} className="relative">
        <input
          className="input pr-9"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          value={text}
          maxLength={200}
          placeholder={placeholder}
          required={required}
          onChange={(e) => {
            onChange(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={handleBlur}
          onKeyDown={onKeyDown}
        />
        <button
          type="button"
          tabIndex={-1}
          className="absolute inset-y-0 right-0 flex items-center px-2.5 text-slate-400 hover:text-slate-600"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setOpen((o) => !o)}
          aria-label="Show recipients"
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>

      {open && menuStyle && createPortal(
        <ul
          ref={menu}
          id={listId}
          role="listbox"
          style={menuStyle}
          className="z-[70] overflow-y-auto overscroll-contain rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
        >
          {rows.length === 0 && (
            <li className="px-3 py-3 text-sm text-slate-400">No recipients yet — type a name to add one</li>
          )}
          {rows.map((row, i) =>
            row.__new ? (
              <li
                key="__new"
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(row)}
                onMouseEnter={() => setActive(i)}
                className={`flex cursor-pointer items-center gap-2 border-t border-slate-100 px-3 py-2 text-sm text-primary-700 ${
                  i === active ? 'bg-primary-50' : ''
                }`}
              >
                <Plus className="h-4 w-4 shrink-0" />
                <span className="truncate">Add “{text.trim()}” as a new recipient</span>
              </li>
            ) : (
              <li
                key={row.id}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(row)}
                onMouseEnter={() => setActive(i)}
                className={`flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm ${
                  i === active ? 'bg-slate-100' : ''
                }`}
              >
                <span className="truncate font-medium">{row.name}</span>
                {row.department && <span className="shrink-0 text-xs text-slate-400">{row.department}</span>}
              </li>
            )
          )}
          {recipients.length > total && !text.trim() && (
            <li className="px-3 py-1.5 text-xs text-slate-400">Showing the first {MAX_SHOWN} — type to search the rest</li>
          )}
        </ul>,
        document.body
      )}

      <div className="mt-1 min-h-[1rem] text-xs">
        {exact ? (
          <p className="flex items-center gap-2 text-slate-500">
            <UserCheck className="h-3.5 w-3.5 text-emerald-600" />
            Saved recipient
            {onEdit && (
              <button
                type="button"
                className="inline-flex items-center gap-1 text-primary-600 hover:underline"
                onClick={() => onEdit(exact)}
              >
                <Pencil className="h-3 w-3" /> Edit name / department
              </button>
            )}
          </p>
        ) : text.trim() ? (
          <p className="text-amber-700">New recipient — added to the list when you confirm the issue.</p>
        ) : (
          <p className="text-slate-400">Pick from the list, or type a new name.</p>
        )}
      </div>
    </div>
  )
}
