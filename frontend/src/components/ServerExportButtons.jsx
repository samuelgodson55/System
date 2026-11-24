import { useEffect, useMemo, useState } from 'react'
import { Download, FileText, Loader2 } from 'lucide-react'
import { api } from '../utils/api'
import { downloadBlob, exportToPDF } from '../utils/export'
import ExportDialog from './ExportDialog'
import ColumnPicker from './ColumnPicker'
import { getExportCatalog, loadSavedColumns, saveColumns } from '../utils/exportColumns'

/**
 * CSV + PDF buttons for a server-built export dataset (see backend services/exports.js).
 *  - CSV is streamed by the server (complete data, no row limit).
 *  - PDF is a downloadable report built from the same rows (capped by the server for speed).
 * `params` are the dataset's filters. `withRange` asks for a date range first.
 * `columns` (default on) shows a Columns picker; the choice is remembered per report. With no choice made,
 * CSV contains every column (as before) and PDF uses the report's tidier default set.
 */
export default function ServerExportButtons({
  dataset, params = {}, title, withRange = false, rangeLabel, disabled = false, className = '', columns = true,
}) {
  const [dialog, setDialog] = useState(null) // 'csv' | 'pdf' | null
  const [busy, setBusy] = useState('') // '' | 'csv' | 'pdf'
  const [error, setError] = useState('')
  const [meta, setMeta] = useState(null) // { columnDefs, pdfDefault } from the catalogue
  const [chosen, setChosen] = useState(null) // null = not customised

  useEffect(() => {
    if (!columns) return undefined
    let live = true
    getExportCatalog()
      .then((list) => {
        const d = list.find((x) => x.id === dataset)
        if (!live || !d?.columnDefs) return // older server: no picker, exports work as before
        setMeta(d)
        setChosen(loadSavedColumns(dataset, d.columnDefs.map((c) => c.key)))
      })
      .catch(() => {}) // the picker is optional; exporting still works without it
    return () => { live = false }
  }, [dataset, columns])

  const allKeys = useMemo(() => meta?.columnDefs.map((c) => c.key) || [], [meta])
  const defaultFor = (fmt) => (fmt === 'pdf' && meta?.pdfDefault ? meta.pdfDefault : allKeys)
  // what the picker shows: the saved choice, else what a PDF would use (the stricter default)
  const shown = chosen || defaultFor('pdf')
  const update = (keys) => {
    const next = keys.length ? allKeys.filter((k) => keys.includes(k)) : allKeys // never allow an empty report
    setChosen(next)
    saveColumns(dataset, next)
  }
  const reset = () => {
    setChosen(null)
    saveColumns(dataset, null)
  }
  // `columns` query value: only sent when it narrows the report
  const columnParam = (fmt) => {
    const keys = chosen || (fmt === 'pdf' ? meta?.pdfDefault : null)
    return keys && keys.length < allKeys.length ? { columns: keys.join(',') } : {}
  }

  const run = async (fmt, from, to) => {
    // with a dialog the range comes from it; otherwise from the caller's params
    const range = withRange ? { from: from || undefined, to: to || undefined } : { from: params.from, to: params.to }
    setBusy(fmt)
    setError('')
    try {
      if (fmt === 'csv') {
        const { blob, filename } = await api.downloadExport(dataset, { ...params, ...columnParam('csv'), ...(withRange ? range : {}) })
        downloadBlob(blob, filename || `${dataset}.csv`)
      } else {
        const res = await api.getExportRows(dataset, { ...params, ...columnParam('pdf'), ...(withRange ? range : {}) })
        if (!res.rows.length) {
          setError('Nothing to export for these filters')
          return
        }
        const keys = res.columns.map((c) => c.key)
        await exportToPDF(
          title || res.title,
          res.columns.map((c) => c.label),
          res.rows.map((r) => keys.map((k) => r[k])),
          dataset,
          { fromDate: range.from, toDate: range.to, summary: res.overview, filters: res.filters }
        )
        if (res.truncated) {
          setError(`PDF shows the first ${res.cap.toLocaleString()} rows. Use CSV for everything.`)
        }
      }
    } catch (e) {
      setError(e.message || 'Export failed')
    } finally {
      setBusy('')
    }
  }

  const start = (fmt) => (withRange ? setDialog(fmt) : run(fmt))

  return (
    <div className={className}>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary" disabled={disabled || !!busy} onClick={() => start('csv')}>
          {busy === 'csv' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} CSV
        </button>
        <button type="button" className="btn-secondary" disabled={disabled || !!busy} onClick={() => start('pdf')}>
          {busy === 'pdf' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />} PDF
        </button>
        {columns && meta && (
          <ColumnPicker
            columns={meta.columnDefs}
            visible={shown}
            onChange={update}
            onReset={reset}
            onSelectAll={() => update(allKeys)}
          />
        )}
      </div>
      {chosen ? (
        <p className="mt-1.5 text-xs text-slate-400">
          Custom columns ({chosen.length} of {allKeys.length}) used for CSV and PDF.
        </p>
      ) : (
        meta?.pdfDefault && (
          <p className="mt-1.5 text-xs text-slate-400">
            CSV has every column; PDF uses a compact set. Use Columns to choose your own.
          </p>
        )
      )}
      {error && <p role="alert" className="mt-1.5 text-xs text-red-600">{error}</p>}
      {withRange && (
        <ExportDialog
          format={dialog}
          title={`Export ${title || dataset}`}
          rangeLabel={rangeLabel}
          onClose={() => setDialog(null)}
          onConfirm={(from, to) => { run(dialog, from, to) }}
        />
      )}
    </div>
  )
}
