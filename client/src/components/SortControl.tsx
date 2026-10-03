import type { GameSort, SortField } from '@psstore/shared'
import { SORT_FIELD_LABELS } from '../modules/sortFields'

interface SortControlProps {
  fields: readonly SortField[]
  sort: GameSort | null
  onFieldChange: (field: SortField | null) => void
  onToggleDirection: () => void
}

// A Default pill restores Sony's own order. Each field pill flips between its
// two directions.
const SortControl = ({
  fields,
  sort,
  onFieldChange,
  onToggleDirection,
}: SortControlProps) => (
  <div role="group" aria-label="Sort" className="sort-bar">
    <button
      type="button"
      className={
        sort === null ? 'sort-bar--pill sort-bar--active' : 'sort-bar--pill'
      }
      aria-pressed={sort === null}
      onClick={() => {
        onFieldChange(null)
      }}
    >
      Default
    </button>
    {fields.map((field) => {
      const label = SORT_FIELD_LABELS[field]
      const active = sort?.field === field
      const direction = active ? sort.direction : null
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
            if (active) {
              onToggleDirection()
            } else {
              onFieldChange(field)
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
