import { useId } from 'react'
import type { GameSort, SortField } from '@psstore/shared'
import { SORT_FIELD_LABELS } from '../modules/sortFields'

interface SortControlProps {
  fields: readonly SortField[]
  // The sort in effect, which is the route default until the user picks one.
  active: GameSort
  onFieldClick: (field: SortField) => void
  onReset: () => void
}

// Exactly one field pill is active and shows its direction. Reset is an
// action, not a state: it restores the route default and stays enabled.
const SortControl = ({
  fields,
  active,
  onFieldClick,
  onReset,
}: SortControlProps) => {
  const labelId = useId()
  return (
    <div role="group" aria-labelledby={labelId} className="sort-bar">
      <span id={labelId} className="sort-bar--label">
        Sort:
      </span>
      <button
        type="button"
        className="sort-bar--pill"
        aria-label="Reset sort to the default order"
        onClick={onReset}
      >
        Reset
      </button>
      {fields.map((field) => {
        const label = SORT_FIELD_LABELS[field]
        const isActive = active.field === field
        return (
          <button
            key={field}
            type="button"
            className={
              isActive ? 'sort-bar--pill sort-bar--active' : 'sort-bar--pill'
            }
            aria-pressed={isActive}
            aria-label={
              isActive
                ? `Sort by ${label.toLowerCase()}, ${active.direction === 'asc' ? 'ascending' : 'descending'}`
                : `Sort by ${label.toLowerCase()}`
            }
            onClick={() => {
              onFieldClick(field)
            }}
          >
            {label}
            {isActive && (
              <span aria-hidden="true">
                {active.direction === 'asc' ? ' ↑' : ' ↓'}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

export default SortControl
