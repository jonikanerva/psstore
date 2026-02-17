import type { Game } from '../types/game.js'

export const filterGamesByGenre = (
  games: Game[],
  genre?: string,
): Game[] => {
  if (!genre) {
    return games
  }

  return games.filter((game) => game.genres.includes(genre))
}

export const sortByDateDesc = (games: Game[]): Game[] =>
  [...games].sort((a, b) => {
    const aTs = a.date ? Date.parse(a.date) : Number.NaN
    const bTs = b.date ? Date.parse(b.date) : Number.NaN
    const aValid = Number.isFinite(aTs)
    const bValid = Number.isFinite(bTs)

    if (aValid && bValid) {
      return bTs - aTs
    }

    if (aValid && !bValid) {
      return -1
    }

    if (!aValid && bValid) {
      return 1
    }

    return 0
  })
