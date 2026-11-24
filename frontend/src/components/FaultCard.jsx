import { Link } from 'react-router-dom'
import { Ban, CheckCircle2, Wrench, Pencil, RotateCcw, Trash2, User } from 'lucide-react'
import { formatDateTime } from '../utils/format'
import { faultTarget, resolutionLabel } from '../utils/faults'

/** One fault, with its actions. `showItem` links to the item (used on the Faults page). */
export default function FaultCard({ fault: f, showItem = false, isAdmin = false, onEdit, onResolve, onReopen, onDelete }) {
  const open = f.status === 'open'
  const bad = f.usability === 'unusable'
  const tone = !open ? 'border-slate-200 bg-white' : bad ? 'border-red-200 bg-red-50/40' : 'border-amber-200 bg-amber-50/40'
  return (
    <div className={`rounded-lg border p-4 ${tone}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {showItem ? (
              <Link to={`/inventory/${f.itemId}`} className="font-medium text-primary-600 hover:underline">{faultTarget(f)}</Link>
            ) : (
              f.componentName && <span className="font-medium">{f.componentName}</span>
            )}
            <span className="font-mono text-xs text-slate-400">{f.sku}</span>
            {open ? (
              bad ? (
                <span className="badge bg-red-100 text-red-700"><Ban className="mr-1 h-3 w-3" /> Out of service</span>
              ) : (
                <span className="badge bg-amber-100 text-amber-800"><CheckCircle2 className="mr-1 h-3 w-3" /> Usable with fault</span>
              )
            ) : (
              <span className="badge bg-green-100 text-green-700">Resolved · {resolutionLabel(f.resolution)}</span>
            )}
            <span className="text-xs text-slate-500">
              {f.quantityAffected} {f.unit} affected
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-800">{f.description}</p>
          {f.workaround && (
            <p className="mt-1 flex items-start gap-1.5 text-sm text-amber-900">
              <Wrench className="mt-0.5 h-3.5 w-3.5 shrink-0" /> <span><strong>How to use it:</strong> {f.workaround}</span>
            </p>
          )}
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 text-xs text-slate-400">
            <span>Reported {formatDateTime(f.reportedAt)} by {f.reportedBy || 'unknown'}</span>
            {f.foundWith && <span className="flex items-center gap-1"><User className="h-3 w-3" /> {f.foundWith}</span>}
          </p>
          {!open && (
            <p className="mt-0.5 text-xs text-slate-400">
              Resolved {formatDateTime(f.resolvedAt)} by {f.resolvedBy || 'unknown'}
              {f.resolutionNotes ? ` · ${f.resolutionNotes}` : ''}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {open ? (
            <>
              <button className="btn-secondary px-3 py-1.5 text-xs" onClick={() => onEdit?.(f)}><Pencil className="h-3.5 w-3.5" /> Edit</button>
              <button className="btn-primary px-3 py-1.5 text-xs" onClick={() => onResolve?.(f)}><CheckCircle2 className="h-3.5 w-3.5" /> Resolve</button>
            </>
          ) : (
            <button className="btn-secondary px-3 py-1.5 text-xs" onClick={() => onReopen?.(f)}><RotateCcw className="h-3.5 w-3.5" /> Reopen</button>
          )}
          {isAdmin && (
            <button className="btn-ghost px-2 py-1.5 text-xs text-red-600" title="Delete record" onClick={() => onDelete?.(f)}><Trash2 className="h-3.5 w-3.5" /></button>
          )}
        </div>
      </div>
    </div>
  )
}
