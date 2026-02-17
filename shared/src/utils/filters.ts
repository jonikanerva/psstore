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
  [...games].sort((a, b) => (a.date < b.date ? 1 : -1))
