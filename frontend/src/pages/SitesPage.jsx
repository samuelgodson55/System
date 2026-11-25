import { useCallback, useEffect, useState } from 'react'
import { Plus, Pencil, Store, Trash2, Power, ArrowRightLeft, CheckCircle2, Users, Package, Calendar } from 'lucide-react'
import { api } from '../utils/api'
import { useAuth } from '../context/AuthContext'
import { useSite } from '../context/SiteContext'
import Modal from '../components/Modal'
import StatusBadge from '../components/StatusBadge'
import EmptyState from '../components/EmptyState'

function FormError({ children }) {
  return children ? <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{children}</div> : null
}

/** Admin: create, rename and (de)activate the company's sites. Staff never see this page. */
export default function SitesPage() {
  const { user } = useAuth()
  const { activeSiteId, switchSite, reloadSites } = useSite()
  const [sites, setSites] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [notice, setNotice] = useState('')
  // { kind: 'create' | 'edit' | 'remove', site? }
  const [dialog, setDialog] = useState(null)
  const [form, setForm] = useState({ name: '', address: '', copyFrom: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      setSites(await api.getSites())
      setLoadError('')
    } catch (e) {
      setLoadError(e.message || 'Could not load sites')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    load()
  }, [load])

  if (user?.role !== 'admin') {
    return <div className="card mx-auto max-w-xl p-6 text-sm text-slate-600">Only administrators can manage sites.</div>
  }

  const open = (kind, site = null) => {
    setDialog({ kind, site })
    setError('')
    setNotice('')
    if (kind === 'create') setForm({ name: '', address: '', copyFrom: '' })
    if (kind === 'edit') setForm({ name: site.name, address: site.address || '', copyFrom: '' })
  }
  const close = () => setDialog(null)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const afterChange = async (message) => {
    setNotice(message)
    setDialog(null)
    await Promise.all([load(), reloadSites()])
  }

  const submit = async (e) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const { kind, site } = dialog
      if (kind === 'create') {
        const created = await api.createSite({
          name: form.name.trim(),
          address: form.address.trim(),
          ...(form.copyFrom ? { copyCatalogueFrom: form.copyFrom } : {}),
        })
        await afterChange(
          form.copyFrom
            ? `${created.name} was created with ${created.itemCount} item(s) copied at zero stock. Receive stock to start.`
            : `${created.name} was created. Add items or receive stock to start.`
        )
      } else if (kind === 'edit') {
        await api.updateSite(site.id, { name: form.name.trim(), address: form.address.trim() })
        await afterChange('Saved.')
      } else if (kind === 'remove') {
        await api.deleteSite(site.id)
        await afterChange(`${site.name} was deleted.`)
      }
    } catch (err) {
      setError(err.message || 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  const toggleActive = async (site) => {
    setNotice('')
    setLoadError('')
    try {
      await api.updateSite(site.id, { isActive: !site.isActive })
      await afterChange(site.isActive ? `${site.name} is deactivated (read-only).` : `${site.name} is active again.`)
    } catch (err) {
      setLoadError(err.message || 'Could not change the site')
    }
  }

  const activeCount = sites.filter((s) => s.isActive).length

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Sites</h1>
          <p className="text-sm text-slate-500">
            Each site keeps its own stock, events, issues and returns. Staff work only in the site assigned to them; you
            can switch between sites from the header.
          </p>
        </div>
        <button className="btn-primary" onClick={() => open('create')}>
          <Plus className="h-4 w-4" /> Add site
        </button>
      </div>

      {notice && (
        <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <CheckCircle2 className="h-4 w-4 shrink-0" /> {notice}
        </div>
      )}
      {loadError && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{loadError}</div>}

      {!loading && sites.length === 0 ? (
        <div className="card">
          <EmptyState icon={Store} title="No sites" description="Add the first site." />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {sites.map((s) => {
            const current = s.id === activeSiteId
            const empty = !s.itemCount && !s.eventCount && !s.staffCount
            return (
              <div key={s.id} className={`card flex flex-col gap-3 p-4 ${current ? 'ring-2 ring-primary-400' : ''}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="truncate text-base font-semibold text-slate-900" title={s.name}>{s.name}</h2>
                    <p className="truncate text-xs text-slate-500">{s.address || 'No address'}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <StatusBadge status={s.isActive ? 'active' : 'completed'}>{s.isActive ? 'Active' : 'Deactivated'}</StatusBadge>
                    {current && <span className="text-[11px] font-medium text-primary-700">Working here</span>}
                  </div>
                </div>

                <dl className="grid grid-cols-3 gap-2 text-center text-xs text-slate-500">
                  <div className="rounded-lg bg-slate-50 py-2">
                    <Package className="mx-auto mb-0.5 h-4 w-4 text-slate-400" />
                    <dt className="sr-only">Items</dt>
                    <dd className="text-sm font-semibold text-slate-800">{s.itemCount}</dd>
                    items
                  </div>
                  <div className="rounded-lg bg-slate-50 py-2">
                    <Users className="mx-auto mb-0.5 h-4 w-4 text-slate-400" />
                    <dt className="sr-only">Staff</dt>
                    <dd className="text-sm font-semibold text-slate-800">{s.staffCount}</dd>
                    staff
                  </div>
                  <div className="rounded-lg bg-slate-50 py-2">
                    <Calendar className="mx-auto mb-0.5 h-4 w-4 text-slate-400" />
                    <dt className="sr-only">Events</dt>
                    <dd className="text-sm font-semibold text-slate-800">{s.eventCount}</dd>
                    events
                  </div>
                </dl>

                <div className="mt-auto flex flex-wrap items-center gap-1 border-t border-slate-100 pt-3">
                  {!current && (
                    <button className="btn-secondary !px-2.5 !py-1.5 text-xs" onClick={() => switchSite(s.id)}>
                      <ArrowRightLeft className="h-3.5 w-3.5" /> Switch to
                    </button>
                  )}
                  <button
                    className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                    title="Edit name / address"
                    onClick={() => open('edit', s)}
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    className="rounded p-1.5 text-slate-400 hover:bg-amber-50 hover:text-amber-600 disabled:opacity-30"
                    title={s.isActive ? 'Deactivate (keeps history, read-only)' : 'Reactivate'}
                    disabled={s.isActive && activeCount <= 1}
                    onClick={() => toggleActive(s)}
                  >
                    <Power className="h-4 w-4" />
                  </button>
                  <button
                    className="ml-auto rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-30"
                    title={empty ? 'Delete this empty site' : 'Only a site with no items, events or staff can be deleted'}
                    disabled={!empty || sites.length <= 1}
                    onClick={() => open('remove', s)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <p className="text-xs text-slate-500">
        Deactivating a site keeps all of its history and makes it read-only. Categories, units and the recipients list are
        shared by every site; stock, events and balances are separate per site. The same SKU can be used in different sites.
      </p>

      <Modal
        open={!!dialog}
        onClose={close}
        size="sm"
        title={{ create: 'Add site', edit: `Edit ${dialog?.site?.name || ''}`, remove: 'Delete site' }[dialog?.kind] || ''}
      >
        {dialog && (
          <form onSubmit={submit} className="space-y-4">
            <FormError>{error}</FormError>

            {dialog.kind !== 'remove' && (
              <>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">Site name</label>
                  <input
                    className="input"
                    value={form.name}
                    onChange={set('name')}
                    maxLength={120}
                    placeholder="e.g. Mombasa Branch"
                    required
                    autoFocus
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">Address (optional)</label>
                  <input className="input" value={form.address} onChange={set('address')} maxLength={200} />
                </div>
              </>
            )}

            {dialog.kind === 'create' && sites.length > 0 && (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">Start with the items of</label>
                <select className="input" value={form.copyFrom} onChange={set('copyFrom')}>
                  <option value="">An empty site (no items)</option>
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>{s.name} ({s.itemCount} items)</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-slate-500">
                  Copies the item list, units and kit contents at <strong>zero stock</strong>. No quantities or history are copied.
                </p>
              </div>
            )}

            {dialog.kind === 'remove' && (
              <p className="text-sm text-slate-600">
                Delete <strong>{dialog.site.name}</strong>? It has no items, events or staff. This cannot be undone.
              </p>
            )}

            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={close}>Cancel</button>
              <button
                type="submit"
                className={dialog.kind === 'remove' ? 'btn-danger' : 'btn-primary'}
                disabled={busy || (dialog.kind !== 'remove' && !form.name.trim())}
              >
                {busy ? 'Working…' : { create: 'Create site', edit: 'Save', remove: 'Delete site' }[dialog.kind]}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  )
}
