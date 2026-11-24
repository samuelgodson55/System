import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Database,
  Download,
  Trash2,
  Plus,
  RefreshCw,
  RotateCcw,
  AlertTriangle,
  Upload,
} from 'lucide-react'
import { api } from '../utils/api'
import { useAuth } from '../context/AuthContext'
import { useInventory } from '../context/InventoryContext'
import { formatDateTime } from '../utils/format'
import Modal from '../components/Modal'

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

export default function BackupPage() {
  const { user } = useAuth()
  const { refresh } = useInventory()
  const [backups, setBackups] = useState([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [restoring, setRestoring] = useState(null)
  const [confirmRestore, setConfirmRestore] = useState(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadPct, setUploadPct] = useState(0)
  const [downloadOnCreate, setDownloadOnCreate] = useState(true)
  const fileInput = useRef(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const list = await api.listBackups()
      setBackups(list)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (user?.role === 'admin') load()
  }, [user, load])

  if (user?.role !== 'admin') {
    return (
      <div className="py-16 text-center">
        <Database className="mx-auto mb-3 h-10 w-10 text-slate-300" />
        <p className="text-slate-500">Admin access required for database backups.</p>
      </div>
    )
  }

  const handleCreate = async () => {
    setCreating(true)
    setError('')
    setMessage('')
    try {
      const result = await api.createBackup()
      setMessage(`Backup created: ${result.filename} (${formatBytes(result.size)})`)
      if (downloadOnCreate) await handleDownload(result.filename)
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setCreating(false)
    }
  }

  const handleDownload = async (filename) => {
    try {
      const res = await api.downloadBackup(filename)
      if (!res.ok) throw new Error('Download failed')
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 10000) // revoking at once can cancel the download in some browsers
    } catch (e) {
      setError(e.message)
    }
  }

  const handleUploadChosen = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = '' // lets the same file be chosen again after a failed attempt
    if (!file) return
    setError('')
    setMessage('')
    if (!/\.sql$/i.test(file.name)) {
      setError('Choose a .sql backup file (one downloaded from this page).')
      return
    }
    setUploading(true)
    setUploadPct(0)
    try {
      const result = await api.uploadBackup(file, setUploadPct)
      setMessage(`Uploaded ${result.filename} (${formatBytes(result.size)}). Confirm below to restore it.`)
      await load()
      setConfirmRestore(result.filename) // straight to the confirmation step
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(false)
    }
  }

  const handleRestore = async () => {
    if (!confirmRestore) return
    setRestoring(confirmRestore)
    setError('')
    setMessage('')
    try {
      const result = await api.restoreBackup(confirmRestore)
      setMessage(result.message || `Restored from ${confirmRestore}`)
      setConfirmRestore(null)
      await refresh()
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setRestoring(null)
    }
  }

  const handleDelete = async (filename) => {
    if (!window.confirm(`Delete backup "${filename}"?`)) return
    try {
      await api.deleteBackup(filename)
      await load()
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Database Backups</h1>
          <p className="text-sm text-slate-500">
            Create, download, restore, or delete PostgreSQL dumps
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="btn-secondary" disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".sql,application/sql,text/plain"
            className="hidden"
            onChange={handleUploadChosen}
          />
          <button
            onClick={() => fileInput.current?.click()}
            className="btn-secondary"
            disabled={uploading || !!restoring}
          >
            <Upload className="h-4 w-4" />
            {uploading ? `Uploading ${uploadPct}%` : 'Upload & Restore'}
          </button>
          <button onClick={handleCreate} className="btn-primary" disabled={creating}>
            <Plus className="h-4 w-4" />
            {creating ? 'Creating…' : 'Create Backup'}
          </button>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-slate-600">
        <input
          type="checkbox"
          checked={downloadOnCreate}
          onChange={(e) => setDownloadOnCreate(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300"
        />
        Also download a copy to this device when I create a backup (recommended)
      </label>

      {error && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}
      {message && (
        <div className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{message}</div>
      )}

      <div className="card overflow-hidden">
        {loading && backups.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-slate-400">Loading…</p>
        ) : backups.length === 0 ? (
          <div className="flex flex-col items-center py-16">
            <Database className="mb-3 h-10 w-10 text-slate-300" />
            <p className="text-slate-500">No backups yet</p>
            <button onClick={handleCreate} className="btn-primary mt-4" disabled={creating}>
              <Plus className="h-4 w-4" /> Create first backup
            </button>
            <button
              onClick={() => fileInput.current?.click()}
              className="mt-2 text-sm text-primary-600 hover:underline"
              disabled={uploading}
            >
              or upload a backup file you downloaded earlier
            </button>
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Filename</th>
                <th className="px-4 py-3 font-medium">Size</th>
                <th className="px-4 py-3 font-medium">Created</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {backups.map((b) => (
                <tr key={b.filename} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs">
                    {b.filename}
                    {b.kind === 'uploaded' && (
                      <span className="ml-2 rounded bg-blue-100 px-1.5 py-0.5 font-sans text-[10px] font-medium text-blue-700">
                        uploaded
                      </span>
                    )}
                    {b.kind === 'safety' && (
                      <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 font-sans text-[10px] font-medium text-slate-600">
                        auto, before restore
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{formatBytes(b.size)}</td>
                  <td className="px-4 py-3 text-slate-500">{formatDateTime(b.createdAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={() => handleDownload(b.filename)}
                        className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-primary-600"
                        title="Download"
                      >
                        <Download className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setConfirmRestore(b.filename)}
                        className="rounded p-1.5 text-slate-400 hover:bg-amber-50 hover:text-amber-600"
                        title="Restore"
                        disabled={!!restoring}
                      >
                        <RotateCcw className={`h-4 w-4 ${restoring === b.filename ? 'animate-spin' : ''}`} />
                      </button>
                      <button
                        onClick={() => handleDelete(b.filename)}
                        className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">
        <strong>Note:</strong> Backups are SQL dumps from <code>pg_dump</code>.
        Restore overwrites current data with the selected dump; the current state is saved automatically first.
        The server&apos;s disk may be wiped on restart or redeploy (e.g. on Render), so <strong>download your
        backups</strong> and keep them somewhere safe. To restore one later, use <strong>Upload &amp; Restore</strong>.
        After a restore you may be signed out if your account is not in that backup.
      </div>

      <Modal
        open={!!confirmRestore}
        onClose={() => setConfirmRestore(null)}
        title="Restore database?"
        size="sm"
      >
        <div className="space-y-4">
          <div className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
            <div>
              <p className="font-medium">This will overwrite current data</p>
              <p className="mt-1 text-amber-800">
                Restoring <code className="rounded bg-amber-100 px-1">{confirmRestore}</code> applies
                that dump to the live database. The current data is saved automatically first, so you can undo
                from the list.
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setConfirmRestore(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary bg-amber-600 hover:bg-amber-700"
              onClick={handleRestore}
              disabled={!!restoring}
            >
              <RotateCcw className="h-4 w-4" />
              {restoring ? 'Restoring…' : 'Yes, restore'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
