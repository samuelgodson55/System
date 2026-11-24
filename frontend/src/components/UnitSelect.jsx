import { unitsForItem, unitOptionLabel } from '../utils/units'
import Select from './Select'

/**
 * Unit dropdown limited to the units that apply to the given item.
 * Falls back to all units only when the item carries no unit list (older data).
 */
export default function UnitSelect({ item, units, value, onChange, className = 'input', ...rest }) {
  const options = unitsForItem(item, units)
  return (
    <Select className={className} value={value} onChange={(e) => onChange(e.target.value)} {...rest}>
      {options.map((u) => (
        <option key={u.id} value={u.id}>
          {unitOptionLabel(u, item, units)}
        </option>
      ))}
    </Select>
  )
}
