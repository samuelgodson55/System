import { ArrowDownToLine, ArrowUpFromLine } from 'lucide-react'
import StatusBadge from './StatusBadge'
import { formatDateTime } from '../utils/format'
import { txnItemLabel } from '../utils/kits'

/**
 * One ledger line (receive / issue / return) as shown in "Recent Activity".
 * Shared by the Dashboard and the full Activity page so both always look the same.
 */
export default function ActivityRow({ txn, item, unit }) {
  return (
    <div className="flex items-center gap-3 px-5 py-3">
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
          txn.type === 'receive' ? 'bg-emerald-100' : 'bg-amber-100'
        }`}
      >
        {txn.type === 'receive' ? (
          <ArrowDownToLine className="h-4 w-4 text-emerald-600" />
        ) : (
          <ArrowUpFromLine className="h-4 w-4 text-amber-600" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{txnItemLabel(txn, item)}</p>
        <p className="text-xs text-slate-400">
          {txn.unitQuantity} {item?.itemType === 'kit' ? (txn.componentId ? 'pcs' : 'sets') : unit?.abbreviation} ·{' '}
          {formatDateTime(txn.createdAt)}
        </p>
      </div>
      <StatusBadge status={txn.type}>{txn.type}</StatusBadge>
    </div>
  )
}
