import type { Query } from '@tanstack/react-query'

// Only anonymous Sony payload caches reach localStorage. Every other key,
// including `['search', term]`, stays in memory.
export const shouldDehydrateQuery = (
  query: Pick<Query, 'queryKey'>,
): boolean => {
  const key = query.queryKey[0]
  return key === 'games' || key === 'game'
}
