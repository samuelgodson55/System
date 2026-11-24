import { useEffect, useState } from 'react'
import { LifeBuoy, Copy, Download, Printer, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { api } from '../utils/api'
import { useAuth } from '../context/AuthContext'

const fmtDate = (v) => (v ? new Date(v).toLocaleString() : '')

/**
 * Admin account recovery: a set of one-time codes that let an admin who forgot their password set a new one
 * from the sign-in page. The codes are shown ONCE (the server keeps only hashes), so the panel makes it easy
 * to copy / download / print them, and makes the person confirm they have been stored safely.
 */
export default function RecoveryCodesPanel() {
  const { user, refreshUser } = useAuth()
  const [status, setStatus] = useState(null) // { remaining, total, generatedAt }
  const [asking, setAsking] = useState(false)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [codes, setCodes] = useState(null) // plain codes, only in memory while shown
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)

  const load = async () => {
    try {
      setStatus(await api.getRecoveryStatus())
    } catch (e) {
      setError(e.message || 'Could not load recovery codes')
    }
  }
  useEffect(() => {
    load()
  }, [])

  const create = async (e) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const res = await api.createRecoveryCodes(password)
      setCodes(res.codes)
      setSaved(false)
      setAsking(false)
      setPassword('')
      await load()
      await refreshUser()
    } catch (err) {
      setError(err.message || 'Could not create recovery codes')
    } finally {
      setBusy(false)
    }
  }

  const text = () =>
    [
      `Recovery codes for ${user?.username}`,
      `Created ${new Date().toLocaleString()}`,
      '',
      'Each code works ONCE. Use one on the sign-in page ("Forgot your password?").',
      'Keep this somewhere safe and private (not on a shared computer).',
      '',
      ...codes.map((c, i) => `${String(i + 1).padStart(2, '0')}.  ${c}`),
      '',
    ].join('\n')

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(codes.join('\n'))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Could not copy automatically – select the codes and copy them by hand.')
    }
  }

  const download = () => {
    const url = URL.createObjectURL(new Blob([text()], { type: 'text/plain' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `recovery-codes-${user?.username}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  const print = () => {
    const w = window.open('', '_blank', 'width=520,height=640')
    if (!w) return setError('Pop-up blocked – use Download instead.')
    const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
    w.document.write(`<pre style="font:16px/1.7 monospace">${esc(text())}</pre>`)
    w.document.close()
    w.focus()
    w.print()
  }

  const low = status && status.total > 0 && status.remaining <= 2

  return (
    <div className="card mt-6 space-y-4 p-5">
      <div className="flex items-start gap-3">
        <LifeBuoy className="mt-0.5 h-6 w-6 shrink-0 text-primary-600" />
        <div>
          <h3 className="text-sm font-semibold text-slate-800">Account recovery codes</h3>
          <p className="mt-0.5 text-sm text-slate-500">
            One-time codes that let you set a new password if you ever forget yours. Keep them somewhere safe –
            anyone holding a code can take over this account.
          </p>
        </div>
      </div>

      {error && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {status && !codes && (
        <p className={`rounded-lg px-4 py-3 text-sm ${status.remaining === 0 || low ? 'bg-amber-50 text-amber-900' : 'bg-slate-50 text-slate-700'}`}>
          {status.total === 0
            ? 'You have no recovery codes yet.'
            : `${status.remaining} of ${status.total} codes left (created ${fmtDate(status.generatedAt)}).`}
          {(status.total === 0 || low) && ' Create a new set now.'}
        </p>
      )}

      {codes && (
        <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="flex items-start gap-2 text-sm font-medium text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            Save these codes now. They are shown only once and cannot be viewed again. Any earlier codes no longer work.
          </p>
          <ol className="grid grid-cols-1 gap-x-6 gap-y-1 rounded-md bg-white p-3 font-mono text-sm tracking-wider sm:grid-cols-2">
            {codes.map((c, i) => (
              <li key={c} className="select-all">
                <span className="mr-2 text-slate-400">{String(i + 1).padStart(2, '0')}</span>
                {c}
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary" onClick={copy}>
              <Copy className="h-4 w-4" /> {copied ? 'Copied' : 'Copy'}
            </button>
            <button type="button" className="btn-secondary" onClick={download}>
              <Download className="h-4 w-4" /> Download
            </button>
            <button type="button" className="btn-secondary" onClick={print}>
              <Printer className="h-4 w-4" /> Print
            </button>
          </div>
          <label className="flex items-start gap-2 text-sm text-amber-900">
            <input type="checkbox" className="mt-1" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
            I have stored these codes somewhere safe.
          </label>
          <button type="button" className="btn-primary" disabled={!saved} onClick={() => setCodes(null)}>
            <CheckCircle2 className="h-4 w-4" /> Done
          </button>
        </div>
      )}

      {!codes && !asking && (
        <button type="button" className="btn-secondary" onClick={() => { setAsking(true); setError('') }}>
          {status?.total ? 'Create a new set of codes' : 'Create recovery codes'}
        </button>
      )}

      {!codes && asking && (
        <form onSubmit={create} className="space-y-3 rounded-lg bg-slate-50 p-4">
          {status?.total > 0 && (
            <p className="text-sm text-amber-800">Creating a new set makes all your current codes stop working.</p>
          )}
          <label className="block text-sm font-medium text-slate-700">Your password (to confirm)</label>
          <input
            type="password"
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            autoFocus
            required
          />
          <div className="flex gap-2">
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? 'Creating…' : 'Create codes'}
            </button>
            <button type="button" className="btn-secondary" onClick={() => { setAsking(false); setPassword('') }}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
