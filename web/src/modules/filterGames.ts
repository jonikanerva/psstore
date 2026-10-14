import type { Game } from '@psstore/api-client'

export const filterGamesByName = (
  games: readonly Game[],
  query: string,
): Game[] => {
  const needle = query.trim().toLowerCase()
  if (needle === '') {
    return [...games]
  }
  return games.filter((g) => g.name.toLowerCase().includes(needle))
}
