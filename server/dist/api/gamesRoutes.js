import { Router } from 'express';
import { getDiscountedGames, getGameById, getNewGames, getPlusGames, getUpcomingGames, searchGames, } from '../services/gamesService.js';
import { gameIdParamSchema, searchQuerySchema } from '../validation/schemas.js';
export const gamesRouter = Router();
gamesRouter.get('/new', async (_request, response, next) => {
    try {
        response.json(await getNewGames());
    }
    catch (error) {
        next(error);
    }
});
gamesRouter.get('/upcoming', async (_request, response, next) => {
    try {
        response.json(await getUpcomingGames());
    }
    catch (error) {
        next(error);
    }
});
gamesRouter.get('/discounted', async (_request, response, next) => {
    try {
        response.json(await getDiscountedGames());
    }
    catch (error) {
        next(error);
    }
});
gamesRouter.get('/plus', async (_request, response, next) => {
    try {
        response.json(await getPlusGames());
    }
    catch (error) {
        next(error);
    }
});
gamesRouter.get('/search', async (request, response, next) => {
    try {
        const { q } = searchQuerySchema.parse(request.query);
        response.json(await searchGames(q));
    }
    catch (error) {
        next(error);
    }
});
gamesRouter.get('/:id', async (request, response, next) => {
    try {
        const { id } = gameIdParamSchema.parse(request.params);
        response.json(await getGameById(id));
    }
    catch (error) {
        next(error);
    }
});
