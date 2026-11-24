import { useEffect, useState } from 'react'
import { Download, FileText } from 'lucide-react'
import { format, subDays, startOfMonth } from 'date-fns'
import Modal from './Modal'

const iso = (d) => format(d, 'yyyy-MM-dd')

/**
 * Clean pop-up shown after clicking CSV / PDF.
 * `onConfirm(from, to)` may return an error string to keep the dialog open.
 * `format` is 'csv' | 'pdf'; the dialog is open whenever it is set.
 */
export default function ExportDialog({ format: fmt, title = 'Export', rangeLabel = 'Date range', onClose, onConfirm }) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [error, setError] = useState('')
  const open = !!fmt

  useEffect(() => {
    if (open) {
      setFrom('')
      setTo('')
      setError('')
    }
  }, [open])

  const today = new Date()
  const presets = [
    { label: 'All time', from: '', to: '' },
    { label: 'Today', from: iso(today), to: iso(today) },
    { label: 'Last 7 days', from: iso(subDays(today, 6)), to: iso(today) },
    { label: 'Last 30 days', from: iso(subDays(today, 29)), to: iso(today) },
    { label: 'This month', from: iso(startOfMonth(today)), to: iso(today) },
  ]

  const submit = () => {
    if (from && to && from > to) {
      setError('"From" date must be on or before the "To" date.')
      return
    }
    const result = onConfirm(from || null, to || null)
    if (typeof result === 'string' && result) {
      setError(result)
      return
    }
    onClose()
  }

  const isCsv = fmt === 'csv'
  return (
    <Modal open={open} onClose={onClose} title={`${title} as ${isCsv ? 'CSV' : 'PDF'}`} size="sm">
      <div className="space-y-4">
        <div>
          <p className="mb-2 text-sm font-medium text-slate-700">{rangeLabel}</p>
          <div className="flex flex-wrap gap-1.5">
            {presets.map((p) => {
              const active = from === p.from && to === p.to
              return (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => {
                    setFrom(p.from)
                    setTo(p.to)
                    setError('')
                  }}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    active
                      ? 'border-primary-600 bg-primary-50 text-primary-700'
                      : 'border-slate-300 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {p.label}
                </button>
              )
            })}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs font-medium text-slate-500">
            From
            <input
              type="date"
              className="input mt-1"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value)
                setError('')
              }}
            />
          </label>
          <label className="block text-xs font-medium text-slate-500">
            To
            <input
              type="date"
              className="input mt-1"
              value={to}
              onChange={(e) => {
                setTo(e.target.value)
                setError('')
              }}
            />
          </label>
        </div>
        <p className="text-xs text-slate-400">Leave both blank to export everything.</p>

        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary" onClick={submit}>
            {isCsv ? <Download className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
            Export {isCsv ? 'CSV' : 'PDF'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
