import type { GameSort, SortField } from '@psstore/shared'
import { SORT_FIELD_LABELS } from '../modules/sortFields'

interface SortControlProps {
  fields: readonly SortField[]
  sort: GameSort | null
  onFieldChange: (field: SortField | null) => void
  onToggleDirection: () => void
}

const isSortField = (
  value: string,
  fields: readonly SortField[],
): value is SortField => fields.some((field) => field === value)

const SortControl = ({
  fields,
  sort,
  onFieldChange,
  onToggleDirection,
}: SortControlProps) => {
  const directionName =
    sort === null
      ? 'Sort direction'
      : `Sort direction: ${sort.direction === 'asc' ? 'ascending' : 'descending'}`
  const glyph = sort === null ? '↕' : sort.direction === 'asc' ? '↑' : '↓'

  return (
    <div className="sort-control">
      <select
        aria-label="Sort by"
        className="sort-control--select"
        value={sort?.field ?? ''}
        onChange={(event) => {
          const value = event.currentTarget.value
          onFieldChange(isSortField(value, fields) ? value : null)
        }}
      >
        <option value="">Default</option>
        {fields.map((field) => (
          <option key={field} value={field}>
            {SORT_FIELD_LABELS[field]}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="sort-control--direction"
        aria-label={directionName}
        disabled={sort === null}
        onClick={onToggleDirection}
      >
        <span aria-hidden="true">{glyph}</span>
      </button>
    </div>
  )
}

export default SortControl
