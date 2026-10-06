import type { genreListSchema, genreSchema } from '../schemas/browse.js'
import type {
  gameDetailSchema,
  gameSchema,
  errorPayloadSchema,
  pageResultSchema,
  plusOfferSchema,
} from '../schemas/game.js'

export type Game = typeof gameSchema.Type
export type GameDetail = typeof gameDetailSchema.Type
export type PlusOffer = typeof plusOfferSchema.Type
export type PageResult = typeof pageResultSchema.Type
export type ErrorPayload = typeof errorPayloadSchema.Type
export type Genre = typeof genreSchema.Type
export type GenreList = typeof genreListSchema.Type
