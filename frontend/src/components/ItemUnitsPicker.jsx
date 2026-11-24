import { Link } from 'react-router-dom'

/**
 * Choose which units of measurement apply to an item.
 * The base unit is always on (every quantity is stored in it) and cannot be unticked.
 *
 * When the item is counted in something other than pieces (litres, kg ...) the units' default
 * factors (which are in pieces) mean nothing for it, so each ticked unit must say how many of
 * the item's own base unit it holds, e.g. 1 Drum = 208 L. `originalUnitIds` are the units the
 * item already had when the form opened; only newly ticked units are forced to have a value, so
 * existing items can still be saved untouched.
 *
 * For such an item each unit is either LARGER than the base unit (1 Carton = 10 pk, stored as a
 * factor) or SMALLER (48 Pieces = 1 pk, stored as the exact count per base unit in `perBase`), so a
 * fraction like 1/48 is never typed or stored as a rounded decimal (0.0208).
 */
export default function ItemUnitsPicker({
  units, baseUnitId, value, onChange, factors = {}, onFactorsChange, originalUnitIds = [],
  perBase = {}, onPerBaseChange,
}) {
  const selected = new Set(value)
  if (baseUnitId) selected.add(baseUnitId)

  const baseUnit = units.find((u) => u.id === baseUnitId)
  const baseIsSystem = !baseUnit || baseUnit.isBase
  const baseLabel = baseIsSystem ? 'pcs' : baseUnit.abbreviation

  const toggle = (id) => {
    if (id === baseUnitId) return
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange([...next])
    if (!next.has(id) && factors[id] !== undefined) {
      const { [id]: _drop, ...rest } = factors
      onFactorsChange?.(rest)
    }
    if (!next.has(id) && perBase[id] !== undefined) {
      const { [id]: _drop, ...rest } = perBase
      onPerBaseChange?.(rest)
    }
  }

  // larger <-> smaller than the base unit (only offered for items not counted in pieces)
  const setMode = (id, smaller) => {
    const { [id]: _f, ...restF } = factors
    const { [id]: _p, ...restP } = perBase
    if (smaller) {
      onFactorsChange?.(restF)
      onPerBaseChange?.({ ...restP, [id]: '' })
    } else {
      onPerBaseChange?.(restP)
    }
  }

  // base unit first, then the rest alphabetically
  const ordered = [...units].sort(
    (a, b) => (b.id === baseUnitId) - (a.id === baseUnitId) || a.name.localeCompare(b.name)
  )
  const overrideUnits = ordered.filter((u) => u.id !== baseUnitId && selected.has(u.id))

  return (
    <fieldset>
      <legend className="mb-1 block text-sm font-medium">Units of measurement</legend>
      <div className="flex flex-wrap gap-2">
        {ordered.map((u) => {
          const isBase = u.id === baseUnitId
          const on = selected.has(u.id)
          return (
            <label
              key={u.id}
              title={
                isBase
                  ? 'Base unit – always available'
                  : baseIsSystem
                    ? `Default: ${u.conversionFactor} pcs per ${u.name}`
                    : `Set how many ${baseLabel} are in one ${u.name}`
              }
              className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                on ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-slate-200 text-slate-600'
              } ${isBase ? 'cursor-not-allowed opacity-80' : 'cursor-pointer hover:bg-slate-50'}`}
            >
              <input
                type="checkbox"
                className="rounded border-slate-300"
                checked={on}
                disabled={isBase}
                onChange={() => toggle(u.id)}
              />
              <span className="font-medium">{u.name}</span>
              <span className="text-xs text-slate-400">
                {u.abbreviation}
                {baseIsSystem && !isBase && u.conversionFactor !== 1 ? ` · ${u.conversionFactor} pcs` : ''}
              </span>
            </label>
          )
        })}
      </div>
      {overrideUnits.length > 0 && (
        <div className="mt-3 space-y-2 rounded-lg bg-slate-50 p-3">
          <p className="text-xs font-medium text-slate-500">
            How many {baseIsSystem ? 'pieces' : baseLabel} in one of each unit, for <em>this</em> item
            {baseIsSystem ? ' (a box of pens is not a box of screws)' : ' (e.g. 1 Drum = 208 L)'}
          </p>
          {overrideUnits.map((u) => {
            const needed = !baseIsSystem && !originalUnitIds.includes(u.id)
            const smaller = !baseIsSystem && perBase[u.id] !== undefined
            if (smaller) {
              return (
                <div key={u.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <input
                    type="number"
                    min="0.0001"
                    step="any"
                    aria-label={`How many ${u.name} in one ${baseLabel}`}
                    className="input w-24 py-1"
                    value={perBase[u.id] ?? ''}
                    placeholder="e.g. 48"
                    required
                    onChange={(e) => onPerBaseChange?.({ ...perBase, [u.id]: e.target.value })}
                  />
                  <span className="shrink-0">{u.name} = 1 {baseLabel}</span>
                  <select
                    className="input w-auto py-1 text-xs"
                    aria-label={`Is ${u.name} larger or smaller than ${baseLabel}`}
                    value="smaller"
                    onChange={(e) => setMode(u.id, e.target.value === 'smaller')}
                  >
                    <option value="larger">larger than {baseLabel}</option>
                    <option value="smaller">smaller than {baseLabel}</option>
                  </select>
                </div>
              )
            }
            return (
              <label key={u.id} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="w-28 shrink-0">1 {u.name} =</span>
                <input
                  type="number"
                  min="0.0001"
                  step="any"
                  className="input w-28 py-1"
                  value={factors[u.id] ?? ''}
                  placeholder={baseIsSystem ? String(u.conversionFactor) : 'e.g. 208'}
                  required={needed}
                  onChange={(e) => onFactorsChange?.({ ...factors, [u.id]: e.target.value })}
                />
                <span className="text-slate-500">{baseLabel}</span>
                {!baseIsSystem && (
                  <select
                    className="input w-auto py-1 text-xs"
                    aria-label={`Is ${u.name} larger or smaller than ${baseLabel}`}
                    value="larger"
                    onChange={(e) => setMode(u.id, e.target.value === 'smaller')}
                  >
                    <option value="larger">larger than {baseLabel}</option>
                    <option value="smaller">smaller than {baseLabel}</option>
                  </select>
                )}
              </label>
            )
          })}
          {baseIsSystem && <p className="text-xs text-slate-400">Leave blank to use the default shown in grey.</p>}
          {!baseIsSystem && (
            <p className="text-xs text-slate-400">
              Pick <em>smaller than {baseLabel}</em> for a part of a {baseLabel} (48 Pieces = 1 {baseLabel}): the
              exact fraction is kept, so pieces always add up to whole {baseLabel === 'pk' ? 'packs' : `${baseLabel}s`}.
            </p>
          )}
        </div>
      )}
      <p className="mt-1 text-xs text-slate-400">
        Only the ticked units can be chosen when receiving, issuing or returning this item. Need another unit?{' '}
        <Link to="/units" className="text-primary-600 hover:underline">
          Add it under Units
        </Link>
        .
      </p>
    </fieldset>
  )
}
