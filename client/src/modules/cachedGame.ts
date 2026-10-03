import type { InfiniteData, QueryClient } from '@tanstack/react-query'
import type { Game, PageResult } from '@psstore/shared'

// Finds a game that a list view already loaded, so the game page can paint
// the name, cover, and prices before its own request finishes. The result is
// partial: list payloads carry no description, media, genres, or publisher.
export const findCachedGame = (
  queryClient: QueryClient,
  gameId: string,
): Game | undefined => {
  const lists = queryClient.getQueriesData<InfiniteData<PageResult>>({
    predicate: (query) =>
      query.queryKey[0] === 'games' || query.queryKey[0] === 'search',
  })
  for (const [, data] of lists) {
    const found = data?.pages
      .flatMap((page) => page.games)
      .find((game) => game.id === gameId)
    if (found) {
      return found
    }
  }

  return undefined
}
