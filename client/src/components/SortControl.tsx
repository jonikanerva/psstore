import {
  NATURAL_DIRECTION,
  type GameSort,
  type SortField,
} from '@psstore/shared'
import { SORT_FIELD_LABELS } from '../modules/sortFields'

interface SortControlProps {
  fields: readonly SortField[]
  sort: GameSort | null
  onFieldChange: (field: SortField | null) => void
  onToggleDirection: () => void
}

// One pill per field. Clicking a pill steps through: natural direction, the
// opposite direction, then back to Sony's own order.
const SortControl = ({
  fields,
  sort,
  onFieldChange,
  onToggleDirection,
}: SortControlProps) => (
  <div role="group" aria-label="Sort" className="sort-bar">
    {fields.map((field) => {
      const label = SORT_FIELD_LABELS[field]
      const active = sort?.field === field
      const direction = active ? sort.direction : null
      const onNaturalDirection = direction === NATURAL_DIRECTION[field]
      return (
        <button
          key={field}
          type="button"
          className={
            active ? 'sort-bar--pill sort-bar--active' : 'sort-bar--pill'
          }
          aria-pressed={active}
          aria-label={
            direction === null
              ? `Sort by ${label.toLowerCase()}`
              : `Sort by ${label.toLowerCase()}, ${direction === 'asc' ? 'ascending' : 'descending'}`
          }
          onClick={() => {
            if (!active) {
              onFieldChange(field)
            } else if (onNaturalDirection) {
              onToggleDirection()
            } else {
              onFieldChange(null)
            }
          }}
        >
          {label}
          {direction !== null && (
            <span aria-hidden="true">{direction === 'asc' ? ' ↑' : ' ↓'}</span>
          )}
        </button>
      )
    })}
  </div>
)

export default SortControl
