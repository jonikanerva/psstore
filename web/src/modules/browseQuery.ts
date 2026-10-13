import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query'
import type { BrowseOrder, PageResult } from '@psstore/shared'
import { fetchBrowseGames, fetchGenres } from './psnStore'

export const BROWSE_PAGE_SIZE = 60

// Neither key is under `games`, so the persister never stores them: the genre
// list and the BROWSE pages stay in memory only.
export const genresQueryOptions = queryOptions({
  queryKey: ['genres'],
  queryFn: ({ signal }) => fetchGenres(signal),
  staleTime: 60 * 60 * 1000,
})

// One query per genre and order. Sony sorts on the server, so a page arrives
// in its final order and the view never loads every page to sort.
export const browseQueryOptions = (genre: string, order: BrowseOrder) =>
  infiniteQueryOptions({
    queryKey: ['browse', genre, order],
    queryFn: ({ pageParam, signal }) =>
      fetchBrowseGames(genre, order, pageParam, BROWSE_PAGE_SIZE, signal),
    initialPageParam: 0,
    getNextPageParam: (lastPage: PageResult) =>
      lastPage.nextOffset ?? undefined,
  })
