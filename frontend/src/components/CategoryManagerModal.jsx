import { useEffect, useState } from 'react'
import { Pencil, Trash2, Check, X, Plus } from 'lucide-react'
import { api } from '../utils/api'
import { useInventory } from '../context/InventoryContext'
import Modal from './Modal'

/**
 * Fix or tidy categories: rename one (every item in it follows), fold a mistyped one into the
 * correct one (merge), add an empty one, or remove one nothing uses. Stock numbers, SKUs and
 * history are never touched.
 */
export default function CategoryManagerModal({ open, onClose, onRenamed }) {
  const { categoryRecords, refreshCategories } = useInventory()
  const [editingId, setEditingId] = useState(null)
  const [draft, setDraft] = useState('')
  const [newName, setNewName] = useState('')
  const [mergeAsk, setMergeAsk] = useState(null) // { id, name, existing }
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (open) {
      setEditingId(null)
      setMergeAsk(null)
      setNewName('')
      setError('')
      setNotice('')
    }
  }, [open])

  const run = async (fn, okMessage) => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await fn()
      await refreshCategories()
      if (okMessage) setNotice(okMessage)
      return true
    } catch (e) {
      setError(e.message || 'Something went wrong')
      return false
    } finally {
      setBusy(false)
    }
  }

  const startEdit = (c) => {
    setEditingId(c.id)
    setDraft(c.name)
    setMergeAsk(null)
    setError('')
    setNotice('')
  }

  const saveRename = async (c, merge = false) => {
    const name = draft.trim().replace(/\s+/g, ' ')
    if (!name) return setError('Category name is required')
    if (name === c.name) return setEditingId(null)
    setBusy(true)
    setError('')
    try {
      const res = await api.renameCategory(c.id, name, merge)
      await refreshCategories()
      onRenamed?.(c.name, res.name)
      setEditingId(null)
      setMergeAsk(null)
      setNotice(
        res.merged
          ? `Merged into “${res.name}” (${res.itemsUpdated} item${res.itemsUpdated === 1 ? '' : 's'} moved).`
          : `Renamed to “${res.name}” (${res.itemsUpdated} item${res.itemsUpdated === 1 ? '' : 's'} updated).`
      )
    } catch (e) {
      if (e.code === 'CATEGORY_EXISTS') {
        setMergeAsk({ category: c, existing: e.data?.existing })
      } else {
        setError(e.message || 'Could not rename the category')
      }
    } finally {
      setBusy(false)
    }
  }

  const add = async (e) => {
    e.preventDefault()
    const name = newName.trim()
    if (!name) return
    const ok = await run(() => api.createCategory(name), `Category “${name}” is ready to use.`)
    if (ok) setNewName('')
  }

  const remove = (c) => {
    if (!window.confirm(`Remove the empty category “${c.name}”?`)) return
    run(() => api.deleteCategory(c.id), `Removed “${c.name}”.`)
  }

  return (
    <Modal open={open} onClose={onClose} title="Manage categories" size="md">
      <div className="space-y-4">
        <p className="text-sm text-slate-500">
          Renaming a category updates every item in it. If a name was mistyped, rename it to the
          correct one and the items are merged.
        </p>

        {error && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        {notice && <div className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>}

        {mergeAsk && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <p>
              “{mergeAsk.existing?.name || draft}” already exists. Merge “{mergeAsk.category.name}” into it?
              All {mergeAsk.category.itemCount} item{mergeAsk.category.itemCount === 1 ? '' : 's'} will move
              there and “{mergeAsk.category.name}” will disappear.
            </p>
            <div className="mt-2 flex gap-2">
              <button className="btn-primary" disabled={busy} onClick={() => saveRename(mergeAsk.category, true)}>
                Merge
              </button>
              <button className="btn-secondary" disabled={busy} onClick={() => setMergeAsk(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}

        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {categoryRecords.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-slate-400">No categories yet</li>
          )}
          {categoryRecords.map((c) => (
            <li key={c.id} className="flex items-center gap-2 px-3 py-2">
              {editingId === c.id ? (
                <form
                  className="flex flex-1 items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault()
                    saveRename(c)
                  }}
                >
                  <input
                    className="input py-1.5"
                    value={draft}
                    maxLength={100}
                    autoFocus
                    onChange={(e) => setDraft(e.target.value)}
                    aria-label={`New name for ${c.name}`}
                  />
                  <button type="submit" className="rounded p-1.5 text-emerald-600 hover:bg-emerald-50" disabled={busy} title="Save">
                    <Check className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    className="rounded p-1.5 text-slate-400 hover:bg-slate-100"
                    onClick={() => {
                      setEditingId(null)
                      setMergeAsk(null)
                    }}
                    title="Cancel"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </form>
              ) : (
                <>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.name}</span>
                  <span className="shrink-0 text-xs text-slate-400">
                    {c.itemCount} item{c.itemCount === 1 ? '' : 's'}
                  </span>
                  <button
                    className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                    onClick={() => startEdit(c)}
                    title="Rename"
                    aria-label={`Rename ${c.name}`}
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  {c.itemCount === 0 && (
                    <button
                      className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      onClick={() => remove(c)}
                      title="Remove (no items use it)"
                      aria-label={`Remove ${c.name}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>

        <form onSubmit={add} className="flex gap-2">
          <input
            className="input"
            placeholder="Add a new category"
            value={newName}
            maxLength={100}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button type="submit" className="btn-secondary shrink-0" disabled={busy || !newName.trim()}>
            <Plus className="h-4 w-4" /> Add
          </button>
        </form>

        <div className="flex justify-end">
          <button className="btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </Modal>
  )
}
