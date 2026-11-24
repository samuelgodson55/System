import { useState } from 'react'
import { Eye, EyeOff, UserCircle, CheckCircle2 } from 'lucide-react'
import { api } from '../utils/api'
import { useAuth } from '../context/AuthContext'
import RecoveryCodesPanel from '../components/RecoveryCodesPanel'

export default function ProfilePage() {
  const { user, updateSession } = useAuth()
  const [name, setName] = useState(user?.name || '')
  const [username, setUsername] = useState(user?.username || '')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const usernameChanged = username.trim() !== user?.username
  const wantsPassword = newPassword !== ''
  const needsCurrent = usernameChanged || wantsPassword
  const dirty = name.trim() !== user?.name || usernameChanged || wantsPassword

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setMessage('')
    if (wantsPassword && newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.')
      return
    }
    setSaving(true)
    try {
      const payload = { name: name.trim(), username: username.trim() }
      if (needsCurrent) payload.currentPassword = currentPassword
      if (wantsPassword) payload.newPassword = newPassword
      const data = await api.updateProfile(payload)
      updateSession(data.token, data.user)
      setName(data.user.name)
      setUsername(data.user.username)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setMessage(
        wantsPassword || usernameChanged
          ? 'Profile updated. Use your new sign-in details next time you log in.'
          : 'Profile updated.'
      )
    } catch (err) {
      setError(err.message || 'Could not update profile')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-6 flex items-center gap-3">
        <UserCircle className="h-10 w-10 text-slate-400" />
        <div>
          <h2 className="text-xl font-semibold text-slate-800">My profile</h2>
          <p className="text-sm capitalize text-slate-500">{user?.role} account</p>
        </div>
      </div>

      {user?.mustChangePassword && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>Choose your own password to continue.</strong> You signed in with a temporary password issued by an
          administrator. Enter it below as your current password, then pick a new one.
        </div>
      )}

      <form onSubmit={submit} className="card space-y-5 p-5">
        {error && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        {message && (
          <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            <CheckCircle2 className="h-4 w-4 shrink-0" /> {message}
          </div>
        )}

        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">Display name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />
          <p className="mt-1 text-xs text-slate-500">Shown in the sidebar and recorded on new stock movements.</p>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-700">Username</label>
          <input
            className="input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            maxLength={50}
            autoComplete="username"
            required
          />
          <p className="mt-1 text-xs text-slate-500">3–50 characters: letters, numbers, dot, dash, underscore.</p>
        </div>

        <div className="border-t border-slate-200 pt-5">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">Change password</h3>
          <div className="space-y-3">
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                className="input pr-10"
                required={!!user?.mustChangePassword}
                placeholder="New password (leave blank to keep current)"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
              />
              <button
                type="button"
                onClick={() => setShowPw(!showPw)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                tabIndex={-1}
              >
                {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {wantsPassword && (
              <input
                type={showPw ? 'text' : 'password'}
                className="input"
                placeholder="Confirm new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
              />
            )}
            <p className="text-xs text-slate-500">At least 8 characters.</p>
          </div>
        </div>

        {needsCurrent && (
          <div className="rounded-lg bg-amber-50 p-3">
            <label className="mb-1.5 block text-sm font-medium text-amber-900">
              Current password <span className="font-normal">(required to change username or password)</span>
            </label>
            <input
              type="password"
              className="input"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
        )}

        <div className="flex justify-end">
          <button type="submit" className="btn-primary" disabled={saving || !dirty}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>

      {user?.role === 'admin' && !user?.mustChangePassword && <RecoveryCodesPanel />}
    </div>
  )
}
