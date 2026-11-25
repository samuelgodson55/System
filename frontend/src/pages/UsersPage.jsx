import { useCallback, useEffect, useState } from 'react'
import { Plus, Pencil, KeyRound, Trash2, Users, Copy, CheckCircle2, ShieldCheck, AlertTriangle } from 'lucide-react'
import { api } from '../utils/api'
import { useAuth } from '../context/AuthContext'
import { useSite } from '../context/SiteContext'
import Modal from '../components/Modal'
import StatusBadge from '../components/StatusBadge'
import EmptyState from '../components/EmptyState'
import { formatDate } from '../utils/format'

const ROLE_HELP = {
  admin: 'Full access: edit and delete items and events, manage units, categories, users, backups and settings.',
  staff: 'Day-to-day work: add items, issue, receive and return stock. Cannot edit or delete records or manage users.',
}

/** The acting admin re-enters their own password for every change on this page. */
function ConfirmPassword({ value, onChange }) {
  return (
    <div className="rounded-lg bg-amber-50 p-3">
      <label className="mb-1.5 block text-sm font-medium text-amber-900">Your password (to confirm this change)</label>
      <input
        type="password"
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete="current-password"
        required
      />
    </div>
  )
}

function FormError({ children }) {
  return children ? <div role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{children}</div> : null
}

/** Shown once after a user is created or a password is reset. The server never shows it again. */
function TempPasswordModal({ info, onClose }) {
  const [copied, setCopied] = useState(false)
  if (!info) return null
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(info.password)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* the password is selectable on screen */
    }
  }
  return (
    <Modal open onClose={onClose} title={info.title} size="sm">
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Give this temporary password to <strong>{info.username}</strong>. They will be asked to choose their own at
          first sign-in.
        </p>
        <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
          <code className="select-all break-all text-lg font-semibold tracking-wider">{info.password}</code>
          <button type="button" className="btn-secondary shrink-0" onClick={copy}>
            <Copy className="h-4 w-4" /> {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <p className="flex items-start gap-2 text-xs text-amber-800">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          It is shown only now and cannot be looked up later. If it is lost, reset the password again.
        </p>
        <div className="flex justify-end">
          <button type="button" className="btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </Modal>
  )
}

export default function UsersPage() {
  const { user: me } = useAuth()
  const { sites, activeSiteId } = useSite()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [notice, setNotice] = useState('')
  // which dialog is open: { kind: 'create' | 'edit' | 'reset' | 'remove', user? }
  const [dialog, setDialog] = useState(null)
  const [tempInfo, setTempInfo] = useState(null)

  // form state shared by the dialogs
  const [form, setForm] = useState({})
  const [adminPassword, setAdminPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      setUsers(await api.getUsers())
      setLoadError('')
    } catch (e) {
      setLoadError(e.message || 'Could not load users')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    load()
  }, [load])

  if (me?.role !== 'admin') {
    return <div className="card mx-auto max-w-xl p-6 text-sm text-slate-600">Only administrators can manage users.</div>
  }

  const open = (kind, user = null) => {
    setDialog({ kind, user })
    setError('')
    setAdminPassword('')
    setNotice('')
    if (kind === 'create') setForm({ username: '', name: '', role: 'staff', password: '', siteId: activeSiteId || sites[0]?.id || '' })
    if (kind === 'edit') setForm({ name: user.name, role: user.role, siteId: user.siteId || activeSiteId || sites[0]?.id || '' })
    if (kind === 'reset') setForm({ password: '' })
  }
  const close = () => setDialog(null)

  const submit = async (e) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const { kind, user } = dialog
      if (kind === 'create') {
        const res = await api.createUser({
          username: form.username.trim(),
          name: form.name.trim(),
          role: form.role,
          ...(form.role === 'staff' ? { siteId: form.siteId } : {}),
          ...(form.password ? { password: form.password } : {}),
          adminPassword,
        })
        setTempInfo({ title: 'Account created', username: res.user.username, password: res.temporaryPassword })
      } else if (kind === 'edit') {
        const body = { adminPassword }
        if (form.name.trim() !== user.name) body.name = form.name.trim()
        if (form.role !== user.role) body.role = form.role
        if (form.role === 'staff' && form.siteId !== (user.siteId || '')) body.siteId = form.siteId
        // moving to another site (or changing role) signs the person out so their screen reloads for the new access
        await api.updateUser(user.id, body)
        setNotice(
          body.role
            ? `${user.username} is now ${body.role === 'admin' ? 'an admin' : 'staff'} and has been signed out.`
            : body.siteId
              ? `${user.username} now works at ${sites.find((x) => x.id === body.siteId)?.name || 'the chosen site'} and has been signed out.`
              : 'Saved.'
        )
      } else if (kind === 'reset') {
        const res = await api.resetUserPassword(user.id, {
          adminPassword,
          ...(form.password ? { newPassword: form.password } : {}),
        })
        setTempInfo({ title: 'Password reset', username: res.username, password: res.temporaryPassword })
      } else if (kind === 'remove') {
        await api.deleteUser(user.id, adminPassword)
        setNotice(`${user.username} was removed.`)
      }
      setDialog(null)
      setAdminPassword('')
      await load()
    } catch (err) {
      setError(err.message || 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const adminCount = users.filter((u) => u.role === 'admin').length

  const siteSelect = form.role === 'admin' ? (
    <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
      Admins are not tied to a site: they can switch between all sites from the header.
    </p>
  ) : (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-slate-700">Site</label>
      <select className="input" value={form.siteId || ''} onChange={set('siteId')} required>
        <option value="" disabled>Choose a site…</option>
        {sites.map((s) => (
          <option key={s.id} value={s.id}>{s.name}{s.isActive ? '' : ' (deactivated)'}</option>
        ))}
      </select>
      <p className="mt-1 text-xs text-slate-500">Staff only see and work with the stock of this site.</p>
    </div>
  )

  const roleSelect = (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-slate-700">Role</label>
      <select className="input" value={form.role || 'staff'} onChange={set('role')}>
        <option value="staff">Staff</option>
        <option value="admin">Admin</option>
      </select>
      <p className="mt-1 text-xs text-slate-500">{ROLE_HELP[form.role || 'staff']}</p>
    </div>
  )

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Users</h1>
          <p className="text-sm text-slate-500">Create accounts, assign roles and reset passwords.</p>
        </div>
        <button className="btn-primary" onClick={() => open('create')}>
          <Plus className="h-4 w-4" /> Add user
        </button>
      </div>

      {notice && (
        <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <CheckCircle2 className="h-4 w-4 shrink-0" /> {notice}
        </div>
      )}
      {loadError && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{loadError}</div>}

      <div className="card overflow-hidden">
        {!loading && users.length === 0 ? (
          <EmptyState icon={Users} title="No users" description="Add the first account." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Username</th>
                  <th className="px-4 py-3 font-medium">Role</th>
                  <th className="px-4 py-3 font-medium">Site</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.map((u) => {
                  const isMe = u.id === me.id
                  return (
                    <tr key={u.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium">
                        {u.name} {isMe && <span className="ml-1 text-xs font-normal text-slate-400">(you)</span>}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600">{u.username}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={u.role === 'admin' ? 'active' : 'upcoming'}>
                          <span className="inline-flex items-center gap-1 capitalize">
                            {u.role === 'admin' && <ShieldCheck className="h-3 w-3" />}
                            {u.role}
                          </span>
                        </StatusBadge>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">
                        {u.role === 'admin' ? <span className="text-slate-400">All sites</span> : u.siteName || <span className="text-red-600">Not assigned</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {u.mustChangePassword ? 'Must set a new password' : 'Active'}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">{formatDate(u.createdAt)}</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">
                          <button
                            className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                            title={isMe ? 'Edit your name in My profile' : 'Edit name / role'}
                            disabled={isMe}
                            onClick={() => open('edit', u)}
                          >
                            <Pencil className={`h-4 w-4 ${isMe ? 'opacity-30' : ''}`} />
                          </button>
                          <button
                            className="rounded p-1.5 text-slate-400 hover:bg-amber-50 hover:text-amber-600"
                            title={isMe ? 'Change your password in My profile' : 'Reset password'}
                            disabled={isMe}
                            onClick={() => open('reset', u)}
                          >
                            <KeyRound className={`h-4 w-4 ${isMe ? 'opacity-30' : ''}`} />
                          </button>
                          <button
                            className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                            title={isMe ? "You can't remove yourself" : 'Remove user'}
                            disabled={isMe || (u.role === 'admin' && adminCount <= 1)}
                            onClick={() => open('remove', u)}
                          >
                            <Trash2 className={`h-4 w-4 ${isMe ? 'opacity-30' : ''}`} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-xs text-slate-500">
        You can't change your own role or remove yourself, and the last admin can never be demoted or removed.
        Removing a user keeps their name on past stock records.
      </p>

      {/* create / edit / reset / remove */}
      <Modal
        open={!!dialog}
        onClose={close}
        size="sm"
        title={
          { create: 'Add user', edit: `Edit ${dialog?.user?.username || ''}`, reset: 'Reset password', remove: 'Remove user' }[dialog?.kind] || ''
        }
      >
        {dialog && (
          <form onSubmit={submit} className="space-y-4">
            <FormError>{error}</FormError>

            {dialog.kind === 'create' && (
              <>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">Full name</label>
                  <input className="input" value={form.name} onChange={set('name')} maxLength={120} required autoFocus />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">Username</label>
                  <input className="input" value={form.username} onChange={set('username')} maxLength={50} autoComplete="off" required />
                  <p className="mt-1 text-xs text-slate-500">3–50 characters: letters, numbers, dot, dash, underscore.</p>
                </div>
                {roleSelect}
                {siteSelect}
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">Temporary password (optional)</label>
                  <input className="input" value={form.password} onChange={set('password')} autoComplete="off" placeholder="Leave blank to generate one" />
                  <p className="mt-1 text-xs text-slate-500">They must change it at first sign-in.</p>
                </div>
              </>
            )}

            {dialog.kind === 'edit' && (
              <>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">Full name</label>
                  <input className="input" value={form.name} onChange={set('name')} maxLength={120} required />
                </div>
                {roleSelect}
                {siteSelect}
                {(form.role !== dialog.user.role || (form.role === 'staff' && form.siteId !== (dialog.user.siteId || ''))) && (
                  <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    Changing the role or site signs {dialog.user.username} out; they sign in again with the new access.
                  </p>
                )}
              </>
            )}

            {dialog.kind === 'reset' && (
              <>
                <p className="text-sm text-slate-600">
                  Set a temporary password for <strong>{dialog.user.name}</strong> (@{dialog.user.username}). They are signed
                  out everywhere and must choose their own password at next sign-in.
                </p>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">Temporary password (optional)</label>
                  <input className="input" value={form.password} onChange={set('password')} autoComplete="off" placeholder="Leave blank to generate one" />
                </div>
              </>
            )}

            {dialog.kind === 'remove' && (
              <p className="text-sm text-slate-600">
                Remove <strong>{dialog.user.name}</strong> (@{dialog.user.username})? They can no longer sign in. Stock records
                they created keep their name. This cannot be undone.
              </p>
            )}

            <ConfirmPassword value={adminPassword} onChange={setAdminPassword} />

            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={close}>Cancel</button>
              <button
                type="submit"
                className={dialog.kind === 'remove' ? 'btn-danger' : 'btn-primary'}
                disabled={
                  busy ||
                  (dialog.kind === 'create' && form.role === 'staff' && !form.siteId) ||
                  (dialog.kind === 'edit' &&
                    form.name.trim() === dialog.user.name &&
                    form.role === dialog.user.role &&
                    (form.role === 'admin' || form.siteId === (dialog.user.siteId || '')))
                }
              >
                {busy ? 'Working…' : { create: 'Create user', edit: 'Save', reset: 'Reset password', remove: 'Remove user' }[dialog.kind]}
              </button>
            </div>
          </form>
        )}
      </Modal>

      <TempPasswordModal info={tempInfo} onClose={() => setTempInfo(null)} />
    </div>
  )
}
