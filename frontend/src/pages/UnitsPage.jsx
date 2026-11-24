import { useState } from 'react'
import { Plus, Pencil, Trash2, Ruler } from 'lucide-react'
import { useInventory } from '../context/InventoryContext'
import Modal from '../components/Modal'
import EmptyState from '../components/EmptyState'
import ServerExportButtons from '../components/ServerExportButtons'

const emptyForm = { name: '', abbreviation: '', conversionFactor: 1, isBase: false }

export default function UnitsPage() {
  const { units, addUnit, updateUnit, deleteUnit } = useInventory()
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm)

  const openCreate = () => {
    setEditing(null)
    setForm(emptyForm)
    setModalOpen(true)
  }

  const openEdit = (unit) => {
    setEditing(unit)
    setForm({
      name: unit.name,
      abbreviation: unit.abbreviation,
      conversionFactor: unit.conversionFactor,
      isBase: unit.isBase,
    })
    setModalOpen(true)
  }

  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (saving) return
    setSaving(true)
    const payload = {
      ...form,
      conversionFactor: Number(form.conversionFactor),
    }
    try {
      if (editing) {
        await updateUnit(editing.id, payload)
      } else {
        await addUnit(payload)
      }
      setModalOpen(false)
    } catch (err) {
      alert(err.message || 'Could not save the unit')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id) => {
    const unit = units.find((u) => u.id === id)
    if (unit?.isBase) {
      alert('Cannot delete the base unit (Piece).')
      return
    }
    if (window.confirm(`Delete unit "${unit.name}"?`)) {
      try {
        await deleteUnit(id)
      } catch (err) {
        alert(err.message || 'Could not delete the unit')
      }
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Units of Measurement</h1>
          <p className="text-sm text-slate-500">
            Define units (Piece, Carton, Litre, Drum …) and their default conversion to the base unit (pieces)
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <ServerExportButtons dataset="units" title="Units of measurement" disabled={units.length === 0} />
          <button onClick={openCreate} className="btn-primary">
            <Plus className="h-4 w-4" /> Add Unit
          </button>
        </div>
      </div>

      <div className="card overflow-hidden">
        {units.length === 0 ? (
          <EmptyState
            icon={Ruler}
            title="No units defined"
            description="Add units like Pack, Carton, etc."
            action={
              <button onClick={openCreate} className="btn-primary">
                <Plus className="h-4 w-4" /> Add Unit
              </button>
            }
          />
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Abbreviation</th>
                <th className="px-4 py-3 font-medium text-right">Conversion Factor</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {units.map((unit) => (
                <tr key={unit.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">{unit.name}</td>
                  <td className="px-4 py-3 font-mono text-slate-500">{unit.abbreviation}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {unit.conversionFactor} pcs
                  </td>
                  <td className="px-4 py-3">
                    {unit.isBase ? (
                      <span className="badge bg-primary-100 text-primary-700">Base</span>
                    ) : (
                      <span className="badge bg-slate-100 text-slate-600">Derived</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={() => openEdit(unit)}
                        className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      {!unit.isBase && (
                        <button
                          onClick={() => handleDelete(unit.id)}
                          className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">
        <strong>Tip:</strong> Conversion factor is how many base pieces equal one of this unit.
        Example: 1 Carton = 48 Pieces → factor = 48. Units are defined once here; each item then
        picks which of them apply to it (Inventory → Edit item → Units of measurement).
        <br />
        <strong>Items measured in litres, kg, metres …:</strong> add the unit here (e.g. Litre, Drum), then
        edit the item, set <em>Counted in</em> to Litre, tick Drum and enter 1 Drum = 208 L. The factor for
        such items is set on the item itself, so you can leave the factor here as it is.
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit Unit' : 'Add Unit'}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Name</label>
            <input
              className="input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Carton"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Abbreviation</label>
            <input
              className="input"
              value={form.abbreviation}
              onChange={(e) => setForm({ ...form, abbreviation: e.target.value })}
              placeholder="e.g. ctn"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">
              Conversion Factor (pieces per unit)
            </label>
            <input
              type="number"
              min="0.0001"
              step="any"
              className="input"
              value={form.conversionFactor}
              onChange={(e) => setForm({ ...form, conversionFactor: e.target.value })}
              required
              disabled={form.isBase}
            />
          </div>
          {!editing && !units.some((u) => u.isBase) && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.isBase}
                onChange={(e) =>
                  setForm({
                    ...form,
                    isBase: e.target.checked,
                    conversionFactor: e.target.checked ? 1 : form.conversionFactor,
                  })
                }
                className="rounded border-slate-300"
              />
              Set as base unit
            </label>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setModalOpen(false)} className="btn-secondary">
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {editing ? 'Save' : 'Create'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
