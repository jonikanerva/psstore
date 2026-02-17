export const filterGamesByGenre = (games, genre) => {
    if (!genre) {
        return games;
    }
    return games.filter((game) => game.genres.includes(genre));
};
export const sortByDateDesc = (games) => [...games].sort((a, b) => (a.date < b.date ? 1 : -1));
