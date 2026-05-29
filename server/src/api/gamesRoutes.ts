import { Router, type Router as ExpressRouter } from 'express'
import {
  getDiscountedGames,
  getGameById,
  getNewGames,
  getUpcomingGames,
} from '../services/gamesService.js'
import { gameIdParamSchema, paginationQuerySchema } from '../validation/schemas.js'

export const gamesRouter: ExpressRouter = Router()

// Express 4 handler types expect a void return, so the async work runs inside a
// `void`-discarded IIFE. Every path forwards errors to `next`, so the promise
// never rejects unhandled. (Matches the existing `void next` idiom in errorMiddleware.)
gamesRouter.get('/new', (request, response, next) => {
  void (async () => {
    try {
      const { offset, size } = paginationQuerySchema.parse(request.query)
      response.json(await getNewGames(offset, size))
    } catch (error) {
      next(error)
    }
  })()
})

gamesRouter.get('/upcoming', (request, response, next) => {
  void (async () => {
    try {
      const { offset, size } = paginationQuerySchema.parse(request.query)
      response.json(await getUpcomingGames(offset, size))
    } catch (error) {
      next(error)
    }
  })()
})

gamesRouter.get('/discounted', (request, response, next) => {
  void (async () => {
    try {
      const { offset, size } = paginationQuerySchema.parse(request.query)
      response.json(await getDiscountedGames(offset, size))
    } catch (error) {
      next(error)
    }
  })()
})

gamesRouter.get('/:id', (request, response, next) => {
  void (async () => {
    try {
      const { id } = gameIdParamSchema.parse(request.params)
      response.json(await getGameById(id))
    } catch (error) {
      next(error)
    }
  })()
})
