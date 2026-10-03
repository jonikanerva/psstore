import type { GameSort, SortField } from '@psstore/shared'
import { SORT_FIELD_LABELS } from '../modules/sortFields'

interface SortControlProps {
  fields: readonly SortField[]
  // The sort in effect, which is the route default until the user picks one.
  active: GameSort
  onFieldClick: (field: SortField) => void
  onReset: () => void
}

// Exactly one field pill is active and shows its direction. Default is an
// action, not a state: it restores the route default and stays enabled.
const SortControl = ({
  fields,
  active,
  onFieldClick,
  onReset,
}: SortControlProps) => (
  <div role="group" aria-label="Sort" className="sort-bar">
    <button type="button" className="sort-bar--pill" onClick={onReset}>
      Default
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

export default SortControl
