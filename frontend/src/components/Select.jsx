import { Children, Fragment, isValidElement, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Search } from 'lucide-react'
import useAnchoredMenu from '../hooks/useAnchoredMenu'

// Lists longer than this get a search box at the top.
const SEARCH_FROM = 8

// Layout classes (width, margin, flex …) belong on the wrapper, everything else on the button.
const LAYOUT = /^(?:[a-z-]+:)*(?:w|min-w|max-w|m[trblxy]?|flex|grow|shrink|basis|self|order|col|row)(?:-|$)/
const splitClass = (cls = '') => {
  const wrap = []
  const field = []
  for (const t of cls.split(/\s+/).filter(Boolean)) (LAYOUT.test(t) ? wrap : field).push(t)
  return [wrap.join(' '), field.join(' ')]
}

const textOf = (node) =>
  Children.toArray(node)
    .map((c) => (typeof c === 'string' || typeof c === 'number' ? String(c) : isValidElement(c) ? textOf(c.props.children) : ''))
    .join('')

// Reads <option> children (also inside fragments / maps) into plain option objects.
function readOptions(children, out = []) {
  Children.forEach(children, (c) => {
    if (!isValidElement(c)) return
    if (c.type === Fragment) readOptions(c.props.children, out)
    else if (c.type === 'option') {
      const label = textOf(c.props.children)
      out.push({
        value: String(c.props.value ?? label),
        label,
        disabled: !!c.props.disabled,
        pinned: !!c.props.pinned, // stays visible while the search box is filtering
      })
    } else if (c.type === 'optgroup') readOptions(c.props.children, out)
  })
  return out
}

/**
 * Drop-in replacement for a native <select> that never grows off the screen.
 *
 * Same API as <select>: `value`, `onChange(e)` (e.target.value), `<option>` children, `disabled`,
 * `required`, `className`. The menu is capped to the space available (flips upwards when needed),
 * scrolls inside itself, supports the keyboard (↑ ↓ Home End Enter Esc, type-ahead) and gains a
 * search box once the list is long. An <option pinned> (e.g. "Add new…") stays visible while searching.
 */
export default function Select({
  value,
  onChange,
  children,
  className = 'input',
  disabled = false,
  required = false,
  name,
  id,
  title,
  autoFocus,
  menuMaxHeight = 288,
  'aria-label': ariaLabel,
}) {
  const options = useMemo(() => readOptions(children), [children])
  const current = String(value ?? '')
  const selected = options.find((o) => o.value === current)
  const shown = selected || options.find((o) => !o.disabled) || options[0]
  const isPlaceholder = !selected || (selected.value === '' && selected.disabled)

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(-1)
  const wrap = useRef(null)
  const btn = useRef(null)
  const menu = useRef(null)
  const searchBox = useRef(null)
  const typed = useRef({ s: '', t: 0 })
  const listId = useId()
  const style = useAnchoredMenu(btn, open, { maxHeight: menuMaxHeight, minWidth: 200 })

  const searchable = options.length > SEARCH_FROM
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((o) => o.pinned || o.label.toLowerCase().includes(q))
  }, [options, query])

  const [wrapCls, fieldCls] = splitClass(className)

  const close = (refocus = true) => {
    setOpen(false)
    setQuery('')
    if (refocus) btn.current?.focus()
  }

  const openMenu = () => {
    if (disabled) return
    setQuery('')
    const idx = options.findIndex((o) => o.value === current && !o.disabled)
    setActive(idx)
    setOpen(true)
  }

  const choose = (o) => {
    if (!o || o.disabled) return
    close()
    if (o.value !== current) onChange?.({ target: { value: o.value, name }, currentTarget: { value: o.value, name } })
  }

  // keep the highlighted row in view / start with the selected one
  useEffect(() => {
    if (!open || !menu.current) return
    menu.current.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [open, active, style])

  useEffect(() => {
    if (open && searchable) searchBox.current?.focus()
  }, [open, searchable])

  // reset the highlight when the filter changes
  useEffect(() => {
    if (!open) return
    setActive(visible.findIndex((o) => !o.disabled))
  }, [query]) // eslint-disable-line react-hooks/exhaustive-deps

  // click outside closes
  useEffect(() => {
    if (!open) return undefined
    const away = (e) => {
      if (wrap.current?.contains(e.target) || menu.current?.contains(e.target)) return
      close(false)
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const step = (dir) => {
    if (!visible.length) return
    let i = active
    for (let n = 0; n < visible.length; n++) {
      i = (i + dir + visible.length) % visible.length
      if (!visible[i].disabled) break
    }
    setActive(i)
  }

  const onKeyDown = (e) => {
    if (disabled) return
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault()
        openMenu()
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // type-ahead on the closed field, like a native select
        const now = Date.now()
        typed.current = { s: (now - typed.current.t > 700 ? '' : typed.current.s) + e.key.toLowerCase(), t: now }
        const hit = options.find((o) => !o.disabled && o.label.toLowerCase().startsWith(typed.current.s))
        if (hit && hit.value !== current) choose(hit)
      }
      return
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); step(1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); step(-1) }
    else if (e.key === 'Home') { e.preventDefault(); setActive(visible.findIndex((o) => !o.disabled)) }
    else if (e.key === 'End') { e.preventDefault(); setActive(visible.map((o) => o.disabled).lastIndexOf(false)) }
    else if (e.key === 'Enter' || (e.key === ' ' && !searchable)) {
      e.preventDefault() // picking must not submit the surrounding form
      choose(visible[active])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation() // don't also close a modal behind it
      close()
    } else if (e.key === 'Tab') close(false)
  }

  return (
    <div ref={wrap} className={`relative ${wrapCls}`}>
      <button
        ref={btn}
        type="button"
        id={id}
        title={title}
        name={name}
        autoFocus={autoFocus}
        disabled={disabled}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={onKeyDown}
        className={`${fieldCls} flex w-full items-center justify-between gap-2 text-left disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500`}
      >
        <span className={`min-w-0 flex-1 truncate ${isPlaceholder ? 'text-slate-400' : ''}`}>{shown?.label || '\u00a0'}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* keeps native "required" validation working for a custom control */}
      {required && (
        <input
          tabIndex={-1}
          aria-hidden="true"
          required
          value={selected && !(selected.value === '' && selected.disabled) ? selected.value : ''}
          onChange={() => {}}
          className="pointer-events-none absolute inset-x-0 bottom-0 h-px w-full opacity-0"
        />
      )}

      {open &&
        style &&
        createPortal(
          <div
            ref={menu}
            style={style}
            className="z-[70] flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg"
          >
            {searchable && (
              <div className="relative shrink-0 border-b border-slate-100 p-2">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  ref={searchBox}
                  className="input py-1.5 pl-8"
                  placeholder="Search…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={onKeyDown}
                  aria-label="Search the list"
                  autoComplete="off"
                />
              </div>
            )}
            <ul id={listId} role="listbox" className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1">
              {visible.length === 0 && <li className="px-3 py-3 text-sm text-slate-400">No matches</li>}
              {visible.map((o, i) => (
                <li
                  key={`${o.value}-${i}`}
                  data-idx={i}
                  role="option"
                  aria-selected={o.value === current}
                  aria-disabled={o.disabled || undefined}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(o)}
                  onMouseEnter={() => !o.disabled && setActive(i)}
                  className={`flex items-center justify-between gap-3 px-3 py-2 text-sm ${
                    o.disabled ? 'cursor-not-allowed text-slate-300' : 'cursor-pointer'
                  } ${i === active && !o.disabled ? 'bg-slate-100' : ''} ${o.value === current ? 'font-medium text-primary-700' : ''}`}
                >
                  <span className="min-w-0 truncate">{o.label}</span>
                  {o.value === current && <Check className="h-4 w-4 shrink-0" />}
                </li>
              ))}
            </ul>
          </div>,
          document.body
        )}
    </div>
  )
}
