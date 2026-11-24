import { piecesOut, plural } from '../../utils/returns'

/** The amount shown for one line: sets + pieces for kits, otherwise quantity and unit. */
export default function OutstandingQuantity({ line }) {
  if (line.itemType === 'kit') {
    const pieces = piecesOut(line)
    return (
      <>
        {line.outstanding > 0 && (
          <p className="text-sm font-semibold tabular-nums text-amber-700">{plural(line.outstanding, 'set', 'sets')}</p>
        )}
        {pieces > 0 && (
          <p className={line.outstanding > 0 ? 'text-xs text-slate-400' : 'text-sm font-semibold tabular-nums text-amber-700'}>
            {plural(pieces, 'piece', 'pieces')} out
          </p>
        )}
      </>
    )
  }
  return (
    <p className="text-sm font-semibold tabular-nums text-amber-700">
      {line.outstanding} {line.unit}
    </p>
  )
}
