import { Router } from 'express'
import {
  getDiscountedGames,
  getGameById,
  getGameDate,
  getNewGames,
  getPlusGames,
  getUpcomingGames,
} from '../services/gamesService.js'
import { gameIdParamSchema, paginationQuerySchema } from '../validation/schemas.js'

export const gamesRouter = Router()

gamesRouter.get('/new', async (request, response, next) => {
  try {
    const { offset, size } = paginationQuerySchema.parse(request.query)
    response.json(await getNewGames(offset, size))
  } catch (error) {
    next(error)
  }
})

gamesRouter.get('/upcoming', async (request, response, next) => {
  try {
    const { offset, size } = paginationQuerySchema.parse(request.query)
    response.json(await getUpcomingGames(offset, size))
  } catch (error) {
    next(error)
  }
})

gamesRouter.get('/discounted', async (request, response, next) => {
  try {
    const { offset, size } = paginationQuerySchema.parse(request.query)
    response.json(await getDiscountedGames(offset, size))
  } catch (error) {
    next(error)
  }
})

gamesRouter.get('/plus', async (request, response, next) => {
  try {
    const { offset, size } = paginationQuerySchema.parse(request.query)
    response.json(await getPlusGames(offset, size))
  } catch (error) {
    next(error)
  }
})

gamesRouter.get('/:id/date', async (request, response, next) => {
  try {
    const { id } = gameIdParamSchema.parse(request.params)
    const date = await getGameDate(id)
    response.json({ date })
  } catch (error) {
    next(error)
  }
})

gamesRouter.get('/:id', async (request, response, next) => {
  try {
    const { id } = gameIdParamSchema.parse(request.params)
    response.json(await getGameById(id))
  } catch (error) {
    next(error)
  }
})
