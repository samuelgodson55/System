import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Pencil, Trash2, Calendar, Eye } from 'lucide-react'
import { useInventory } from '../context/InventoryContext'
import { useAuth } from '../context/AuthContext'
import Modal from '../components/Modal'
import StatusBadge from '../components/StatusBadge'
import EmptyState from '../components/EmptyState'
import { formatDate } from '../utils/format'
import ServerExportButtons from '../components/ServerExportButtons'

const emptyForm = {
  name: '',
  description: '',
  location: '',
  startDate: '',
  endDate: '',
  status: 'upcoming',
}

const statuses = ['upcoming', 'active', 'completed']

export default function EventsPage() {
  const { events, addEvent, updateEvent, deleteEvent } = useInventory()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin' // editing / deleting events is admin-only (the server enforces it too)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const openCreate = () => {
    setEditing(null)
    setForm(emptyForm)
    setFormError('')
    setModalOpen(true)
  }

  const openEdit = (evt) => {
    if (!isAdmin) return
    setEditing(evt)
    setForm({
      name: evt.name,
      description: evt.description || '',
      location: evt.location || '',
      // a date input only accepts YYYY-MM-DD
      startDate: String(evt.startDate || '').slice(0, 10),
      endDate: String(evt.endDate || '').slice(0, 10),
      status: evt.status,
    })
    setFormError('')
    setModalOpen(true)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (saving) return
    if (form.startDate && form.endDate && form.endDate < form.startDate) {
      setFormError('The end date cannot be before the start date')
      return
    }
    setSaving(true)
    setFormError('')
    try {
      if (editing) {
        await updateEvent(editing.id, form)
      } else {
        await addEvent(form)
      }
      setModalOpen(false)
    } catch (err) {
      setFormError(err.message || 'Could not save the event')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id) => {
    if (!isAdmin) return
    if (window.confirm('Delete this event?')) {
      try {
        await deleteEvent(id)
      } catch (err) {
        alert(err.message || 'Could not delete the event')
      }
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Events</h1>
          <p className="text-sm text-slate-500">
            Manage events and view stock used for each
          </p>
        </div>
        <div className="flex flex-wrap items-start gap-2">
          <ServerExportButtons dataset="events" title="Events" withRange rangeLabel="Event start date" disabled={events.length === 0} />
          <button onClick={openCreate} className="btn-primary">
            <Plus className="h-4 w-4" /> Add Event
          </button>
        </div>
      </div>

      {events.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={Calendar}
            title="No events yet"
            description="Create events to track stock used for specific occasions."
            action={
              <button onClick={openCreate} className="btn-primary">
                <Plus className="h-4 w-4" /> Add Event
              </button>
            }
          />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {events.map((evt) => {
            const txnCount = evt.txnCount || 0
            return (
              <div key={evt.id} className="card flex flex-col p-5">
                <div className="mb-3 flex items-start justify-between">
                  <Calendar className="h-5 w-5 text-primary-500" />
                  <StatusBadge status={evt.status}>{evt.status}</StatusBadge>
                </div>
                <h3 className="font-semibold">{evt.name}</h3>
                <p className="mt-1 flex-1 text-sm text-slate-500">{evt.description}</p>
                <div className="mt-3 space-y-1 text-xs text-slate-400">
                  <p>📍 {evt.location}</p>
                  <p>
                    📅 {formatDate(evt.startDate)}
                    {evt.endDate && evt.endDate !== evt.startDate && ` → ${formatDate(evt.endDate)}`}
                  </p>
                  <p className="text-primary-600">{txnCount} stock transaction(s)</p>
                </div>
                <div className="mt-4 flex gap-2 border-t border-slate-100 pt-3">
                  <Link
                    to={`/events/${evt.id}`}
                    className="btn-ghost flex-1 text-xs text-primary-600"
                  >
                    <Eye className="h-3.5 w-3.5" /> View stock
                  </Link>
                  {isAdmin && (
                    <>
                      <button onClick={() => openEdit(evt)} className="btn-ghost flex-1 text-xs">
                        <Pencil className="h-3.5 w-3.5" /> Edit
                      </button>
                      <button
                        onClick={() => handleDelete(evt.id)}
                        className="btn-ghost flex-1 text-xs text-red-600 hover:bg-red-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Delete
                      </button>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit Event' : 'Add Event'}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {formError && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{formError}</div>}
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
            <label className="mb-1 block text-sm font-medium">Location</label>
            <input
              className="input"
              value={form.location}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">Start Date</label>
              <input
                type="date"
                className="input"
                value={form.startDate}
                onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">End Date</label>
              <input
                type="date"
                className="input"
                value={form.endDate}
                onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                required
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Status</label>
            <select
              className="input"
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
            >
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={() => setModalOpen(false)} className="btn-secondary">
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save' : 'Create'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
