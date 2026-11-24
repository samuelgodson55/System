import { useEffect, useMemo, useState } from 'react'
import Select from './Select'

const NEW_VALUE = '__new__'

/**
 * Category picker: choose from the categories already in use, or pick
 * "+ Add new category…" to type a brand-new one.
 * Matching is case-insensitive, so typing "cleaning" re-uses an existing "Cleaning".
 */
export default function CategorySelect({ value, onChange, categories = [], required = true }) {
  const current = (value || '').trim()

  // Existing categories (plus the current value, so editing an item never loses its own)
  const options = useMemo(() => {
    const seen = new Map()
    for (const c of [...categories, current]) {
      const t = (c || '').trim()
      if (t && !seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t)
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b))
  }, [categories, current])

  const matchExisting = (text) =>
    options.find((o) => o.toLowerCase() === text.trim().toLowerCase())

  // Show the text box when the user chose "add new", or when there is nothing to pick from yet
  const [adding, setAdding] = useState(false)
  useEffect(() => {
    if (options.length === 0) setAdding(true)
  }, [options.length])

  const showInput = adding || options.length === 0
  const typed = showInput ? value : ''
  const exists = showInput && typed.trim() && matchExisting(typed)

  const handleSelect = (e) => {
    const v = e.target.value
    if (v === NEW_VALUE) {
      setAdding(true)
      onChange('')
    } else {
      setAdding(false)
      onChange(v)
    }
  }

  return (
    <div className="space-y-2">
      {options.length > 0 && (
        <Select
          className="input"
          value={showInput ? NEW_VALUE : matchExisting(current) || ''}
          onChange={handleSelect}
          required={required && !showInput}
        >
          <option value="" disabled>
            Select a category…
          </option>
          {options.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
          <option value={NEW_VALUE} pinned>＋ Add new category…</option>
        </Select>
      )}
      {showInput && (
        <>
          <input
            className="input"
            placeholder="New category name"
            value={value}
            maxLength={100}
            autoFocus={options.length > 0}
            onChange={(e) => onChange(e.target.value)}
            onBlur={() => {
              // snap to the existing spelling instead of creating a near-duplicate
              const m = matchExisting(value || '')
              if (m) onChange(m)
              else onChange((value || '').trim())
            }}
            required={required}
          />
          {exists && (
            <p className="text-xs text-slate-500">“{matchExisting(typed)}” already exists and will be used.</p>
          )}
        </>
      )}
    </div>
  )
}
