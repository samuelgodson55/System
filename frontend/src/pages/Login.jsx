import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Package, Eye, EyeOff, KeyRound, CheckCircle2 } from 'lucide-react'
import { api } from '../utils/api'
import { useAuth } from '../context/AuthContext'
import { useBranding } from '../context/BrandingContext'

export default function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  // 'signin' | 'recover' (admin forgot their password and uses a recovery code)
  const [mode, setMode] = useState('signin')
  const [recoveryCode, setRecoveryCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [notice, setNotice] = useState('')
  const { login } = useAuth()
  const { companyName, siteLocation } = useBranding()
  const navigate = useNavigate()

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    const result = await login(username.trim(), password)
    setLoading(false)
    if (result.success) {
      navigate('/')
    } else {
      setError(result.error)
    }
  }

  const handleRecover = async (e) => {
    e.preventDefault()
    setError('')
    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.')
      return
    }
    setLoading(true)
    try {
      const res = await api.recoverAccount(username.trim(), recoveryCode, newPassword)
      setMode('signin')
      setPassword('')
      setRecoveryCode('')
      setNewPassword('')
      setConfirmPassword('')
      setNotice(
        res.remaining <= 2
          ? `Password updated. Only ${res.remaining} recovery code${res.remaining === 1 ? '' : 's'} left – create a new set after you sign in.`
          : 'Password updated. Sign in with your new password.'
      )
    } catch (err) {
      setError(err.message || 'Could not reset the password')
    } finally {
      setLoading(false)
    }
  }

  const switchMode = (next) => {
    setMode(next)
    setError('')
    setNotice('')
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-primary-900 p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-500 shadow-lg shadow-primary-500/30">
            <Package className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">{companyName || 'Inventory Manager'}</h1>
          {companyName && <p className="mt-0.5 text-sm font-medium text-primary-300">Inventory Manager</p>}
          {siteLocation && <p className="mt-0.5 text-sm text-slate-300">{siteLocation}</p>}
          <p className="mt-1 text-sm text-slate-400">
            {mode === 'recover' ? 'Recover an administrator account' : 'Sign in to manage your stock'}
          </p>
        </div>

        {mode === 'recover' ? (
          <form onSubmit={handleRecover} className="card space-y-4 p-6 shadow-xl">
            {error && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
            <p className="text-sm text-slate-600">
              Administrators can set a new password with one of the one-time recovery codes they saved.
              Staff accounts: ask an administrator to reset your password.
            </p>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Admin username</label>
              <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Recovery code</label>
              <input
                className="input font-mono tracking-wider"
                value={recoveryCode}
                onChange={(e) => setRecoveryCode(e.target.value)}
                placeholder="XXXX-XXXX-XXXX"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                required
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">New password</label>
              <input
                type={showPw ? 'text' : 'password'}
                className="input"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
              <p className="mt-1 text-xs text-slate-500">At least 8 characters.</p>
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Confirm new password</label>
              <input
                type={showPw ? 'text' : 'password'}
                className="input"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-500">
              <input type="checkbox" checked={showPw} onChange={(e) => setShowPw(e.target.checked)} /> Show passwords
            </label>
            <button type="submit" className="btn-primary w-full" disabled={loading}>
              <KeyRound className="h-4 w-4" /> {loading ? 'Checking…' : 'Set new password'}
            </button>
            <button type="button" onClick={() => switchMode('signin')} className="w-full text-center text-sm text-primary-600 hover:underline">
              Back to sign in
            </button>
          </form>
        ) : (
        <form onSubmit={handleSubmit} className="card p-6 shadow-xl">
          {notice && (
            <div className="mb-4 flex items-start gap-2 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> {notice}
            </div>
          )}
          {error && (
            <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="mb-4">
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="input"
              placeholder="Enter username"
              autoFocus
              required
            />
          </div>

          <div className="mb-6">
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Password</label>
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input pr-10"
                placeholder="Enter password"
                required
              />
              <button
                type="button"
                onClick={() => setShowPw(!showPw)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <button type="submit" className="btn-primary w-full" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
          <button type="button" onClick={() => switchMode('recover')} className="mt-3 w-full text-center text-sm text-slate-500 hover:text-primary-600 hover:underline">
            Forgot your password?
          </button>

          {/* Only in `npm run dev`: a production build must not advertise the default logins */}
          {import.meta.env.DEV && (
            <div className="mt-5 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
              <p className="font-medium text-slate-600">Demo credentials</p>
              <p className="mt-1">admin / admin123 · staff / staff123</p>
            </div>
          )}
        </form>
        )}
      </div>
    </div>
  )
}
