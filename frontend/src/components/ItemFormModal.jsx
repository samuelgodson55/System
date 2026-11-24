import { useEffect, useState } from 'react'
import { useInventory } from '../context/InventoryContext'
import { useAuth } from '../context/AuthContext'
import Modal from './Modal'
import KitComponentsEditor from './KitComponentsEditor'
import ItemUnitsPicker from './ItemUnitsPicker'
import CategorySelect from './CategorySelect'
import CategoryManagerModal from './CategoryManagerModal'
import { baseAbbr, suggestPerBase } from '../utils/units'
import Select from './Select'

const emptyForm = {
  sku: '',
  name: '',
  description: '',
  category: '',
  quantity: 0,
  baseUnitId: '',
  unitIds: [],
  unitFactors: {},
  unitsPerBase: {},
  reorderLevel: 10,
  location: '',
  itemType: 'consumable',
  piecesPerSet: '',
  kitNotes: '',
  components: [],
}

/** Form values for an existing item, or the blank form (base unit pre-ticked) for a new one. */
function buildForm(item, units) {
  if (!item) {
    const baseUnitId = units.find((u) => u.isBase)?.id || ''
    return { ...emptyForm, baseUnitId, unitIds: baseUnitId ? [baseUnitId] : [] }
  }
  // Units of an item that is not counted in pieces which are a part of its base unit (Piece = 1/48 pack):
  // shown and saved as "48 per pack". Old items saved before this existed hold a rounded decimal
  // (0.0208); when that is clearly 1/N the form pre-fills N so one Save repairs it.
  const sysBaseItem = units.find((x) => x.id === item.baseUnitId)?.isBase ?? true
  const perBase = {}
  if (!sysBaseItem) {
    for (const [uid, n] of Object.entries(item.unitsPerBase || {})) perBase[uid] = String(n)
    for (const [uid, f] of Object.entries(item.unitFactors || {})) {
      if (uid === item.baseUnitId || perBase[uid] !== undefined) continue
      const n = suggestPerBase(f)
      if (n) perBase[uid] = String(n)
    }
  }
  return {
    sku: item.sku,
    name: item.name,
    description: item.description,
    category: item.category || '',
    // The form always works with the TOTAL owned (in store + out with people), matching the
    // "Total Qty" on the Inventory list. Kits: total sets owned. Others: totalQuantity.
    quantity: item.itemType === 'kit' && item.totalSets != null
      ? item.totalSets
      : (item.totalQuantity ?? item.quantity),
    baseUnitId: item.baseUnitId,
    unitIds: item.unitIds?.length ? item.unitIds : [item.baseUnitId],
    // Items counted in pieces: show only factors that differ from the unit's default as
    // overrides. Items counted in something else (litres ...): the defaults are in pieces and
    // mean nothing, so every stored factor is shown.
    unitFactors: Object.fromEntries(
      Object.entries(item.unitFactors || {}).filter(([uid, f]) => {
        if (uid === item.baseUnitId) return false
        const u = units.find((x) => x.id === uid)
        if (!u) return false
        const sysBase = units.find((x) => x.id === item.baseUnitId)?.isBase ?? true
        if (!sysBase && perBase[uid] !== undefined) return false
        return sysBase ? !u.isBase && Number(u.conversionFactor) !== Number(f) : true
      })
    ),
    unitsPerBase: perBase,
    reorderLevel: item.reorderLevel,
    location: item.location,
    itemType: item.itemType || 'consumable',
    piecesPerSet: item.piecesPerSet ?? '',
    kitNotes: item.kitNotes ?? '',
    components: (item.components || []).map((c) => ({
      id: c.id, name: c.name, quantityPerKit: c.quantityPerKit, notes: c.notes || '',
    })),
  }
}

/**
 * Add / edit an inventory item. Pass `item` to edit it, or leave it empty to create one.
 * Shared by the Inventory list and the item page so both edit exactly the same way.
 */
export default function ItemFormModal({ open, onClose, item = null, onSaved }) {
  const { units, items, categories, addItem, updateItem } = useInventory()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const editing = item
  // Staff can add items but not edit existing ones (the server enforces this as well)
  const blocked = !!item && !isAdmin
  const [form, setForm] = useState(() => buildForm(item, units))
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [managingCategories, setManagingCategories] = useState(false)

  // Start from fresh values every time the dialog is opened
  useEffect(() => {
    if (open) {
      setForm(buildForm(item, units))
      setFormError('')
      setManagingCategories(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item?.id])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (blocked) return
    setFormError('')
    const isKit = form.itemType === 'kit'
    const components = isKit
      ? form.components
          .filter((c) => c.name.trim())
          .map((c) => ({
            id: c.id,
            name: c.name.trim(),
            quantityPerKit: Number(c.quantityPerKit),
            notes: c.notes || null,
          }))
      : []
    const listed = components.reduce((n, c) => n + c.quantityPerKit, 0)
    const payload = {
      ...form,
      sku: form.sku.trim(),
      category: form.category.trim(),
      // Only send stock when the user actually changed it: stock moves with every receipt /
      // issue, so re-sending the number the form was opened with would overwrite newer changes.
      // (Kits being edited send `totalSets` instead; the server adjusts the shelf count.)
      // Non-kit edits send `totalQuantity`; the server subtracts what is out to get the in-store count.
      quantity: editing ? undefined : Number(form.quantity),
      totalQuantity: editing && editing.itemType !== 'kit' && !isKit
        && Number(form.quantity) !== Number(editing.totalQuantity ?? editing.quantity)
        ? Number(form.quantity) : undefined,
      totalSets: editing && editing.itemType === 'kit' && isKit && editing.totalSets != null
        && Number(form.quantity) !== Number(editing.totalSets) ? Number(form.quantity) : undefined,
      reorderLevel: Number(form.reorderLevel),
      piecesPerSet: isKit && (form.piecesPerSet || listed) ? Number(form.piecesPerSet || listed) : null,
      kitNotes: isKit ? form.kitNotes : null,
      components,
    }
    setSaving(true)
    try {
      const saved = editing ? await updateItem(editing.id, payload) : await addItem(payload)
      onClose()
      onSaved?.(saved)
    } catch (err) {
      setFormError(err.message || 'Could not save the item')
    } finally {
      setSaving(false)
    }
  }

  // Changing what the item is counted in: keep the new base ticked and drop factors that were
  // measured against the old one.
  const handleBaseChange = (baseUnitId) =>
    setForm((f) => ({
      ...f,
      baseUnitId,
      unitIds: [...new Set([baseUnitId, ...f.unitIds])],
      unitFactors: {},
      unitsPerBase: {},
    }))

  const countedIn = baseAbbr({ baseUnitId: form.baseUnitId }, units)

  // A category was renamed / merged in the manager while this form is open: follow it, so saving
  // the item does not bring the old (mistyped) name back.
  const handleCategoryRenamed = (from, to) =>
    setForm((f) => (f.category.trim().toLowerCase() === from.toLowerCase() ? { ...f, category: to } : f))

  return (
    <>
    <Modal
      open={open && !blocked}
      onClose={onClose}
      title={editing ? 'Edit Item' : 'Add Item'}
      size={form.itemType === 'kit' ? 'lg' : 'md'}
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {formError && (
          <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{formError}</div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium">SKU</label>
            <input
              className="input"
              value={form.sku}
              maxLength={50}
              onChange={(e) => setForm({ ...form, sku: e.target.value })}
              placeholder={editing ? '' : 'Auto-generated if left blank'}
              required={!!editing}
            />
            {!editing && (
              <p className="mt-1 text-xs text-slate-400">Leave blank to generate one from the category.</p>
            )}
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="block text-sm font-medium">Category</label>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => setManagingCategories(true)}
                  className="text-xs text-primary-600 hover:underline"
                >
                  Rename / manage
                </button>
              )}
            </div>
            <CategorySelect
              value={form.category}
              onChange={(category) => setForm((f) => ({ ...f, category }))}
              categories={categories}
            />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Name</label>
          <input
            className="input"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Description</label>
          <textarea
            className="input"
            rows={2}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Item Type</label>
          <div className="flex flex-wrap gap-2">
            {['consumable', 'reusable', 'kit'].map((t) => (
              <label
                key={t}
                className={`flex flex-1 cursor-pointer items-center justify-center rounded-lg border px-3 py-2.5 text-sm font-medium capitalize transition-colors ${
                  form.itemType === t
                    ? 'border-primary-500 bg-primary-50 text-primary-700'
                    : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <input
                  type="radio"
                  name="itemType"
                  value={t}
                  checked={form.itemType === t}
                  onChange={() => setForm({ ...form, itemType: t })}
                  className="sr-only"
                />
                {t === 'kit' ? 'Kit / Tool set' : t}
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Reusable & kits can be returned. A kit is a multi-piece tool set (e.g. 80-in-1): list what is inside and each piece can be issued on its own or as the whole set.
          </p>
          {form.itemType === 'kit' && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium">Pieces per set (e.g. the 80 in 80-in-1)</label>
                <input
                  type="number"
                  min="1"
                  className="input"
                  value={form.piecesPerSet}
                  onChange={(e) => setForm({ ...form, piecesPerSet: e.target.value })}
                  placeholder="e.g. 80"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-sm font-medium">Kit contents / notes</label>
                <input
                  className="input"
                  value={form.kitNotes}
                  onChange={(e) => setForm({ ...form, kitNotes: e.target.value })}
                  placeholder="e.g. Phillips, Torx, hex bits, extension rods"
                />
              </div>
              <div className="sm:col-span-2">
                <KitComponentsEditor
                  value={form.components}
                  onChange={(components) => setForm({ ...form, components })}
                  declaredPieces={form.piecesPerSet}
                />
              </div>
            </div>
          )}
        </div>
        {/* Kits that list their pieces are counted in sets/pieces, so units don't apply to them */}
        {!(form.itemType === 'kit' && form.components.some((c) => c.name.trim())) && (
          <>
          <div>
            <label className="mb-1 block text-sm font-medium">Counted in (base unit)</label>
            <Select
              className="input"
              value={form.baseUnitId}
              onChange={(e) => handleBaseChange(e.target.value)}
              disabled={!!editing?.hasHistory}
              required
            >
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.abbreviation})
                </option>
              ))}
            </Select>
            <p className="mt-1 text-xs text-slate-400">
              {editing?.hasHistory
                ? "This item already has stock history, so what it is counted in can't be changed."
                : 'What the stock number is measured in, e.g. Litre for engine oil. Tick a bigger unit (Drum) below to receive it in that and issue it in litres.'}
            </p>
          </div>
          <ItemUnitsPicker
            originalUnitIds={editing?.unitIds || []}
            units={units}
            baseUnitId={form.baseUnitId}
            value={form.unitIds}
            onChange={(unitIds) => setForm((f) => ({ ...f, unitIds }))}
            factors={form.unitFactors}
            onFactorsChange={(unitFactors) => setForm((f) => ({ ...f, unitFactors }))}
            perBase={form.unitsPerBase}
            onPerBaseChange={(unitsPerBase) => setForm((f) => ({ ...f, unitsPerBase }))}
          />
          </>
        )}
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-sm font-medium">
              {form.itemType === 'kit' ? 'Total sets owned' : editing ? `Total quantity (${countedIn})` : `Quantity (${countedIn})`}
            </label>
            <input
              type="number"
              min="0"
              step="any"
              className="input"
              value={form.quantity}
              onChange={(e) => setForm({ ...form, quantity: e.target.value })}
              required
            />
            {form.itemType !== 'kit' && editing && Number(editing.outstanding) > 0 && (
              <p className="mt-1 text-xs text-slate-500">
                Everything you own, including {editing.outstanding} currently issued out
                ({editing.quantity} in store). Can't be less than {editing.outstanding}.
              </p>
            )}
            {form.itemType === 'kit' && (
              <p className="mt-1 text-xs text-slate-500">
                Every set you own, including any that are opened or issued out.
                {editing?.itemType === 'kit'
                  ? ` Complete sets on the shelf (${editing.quantity}) are worked out for you.`
                  : ''}
              </p>
            )}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Reorder Level</label>
            <input
              type="number"
              min="0"
              step="any"
              className="input"
              value={form.reorderLevel}
              onChange={(e) => setForm({ ...form, reorderLevel: e.target.value })}
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Location</label>
            <input
              className="input"
              value={form.location}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Saving…' : editing ? 'Save Changes' : 'Create Item'}
          </button>
        </div>
      </form>
    </Modal>
    <CategoryManagerModal
      open={open && !blocked && isAdmin && managingCategories}
      onClose={() => setManagingCategories(false)}
      onRenamed={handleCategoryRenamed}
    />
    </>
  )
}
