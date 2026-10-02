import type {
  gameSchema,
  errorPayloadSchema,
  pageResultSchema,
  plusOfferSchema,
} from '../schemas/game.js'

export type Game = typeof gameSchema.Type
export type PlusOffer = typeof plusOfferSchema.Type
export type PageResult = typeof pageResultSchema.Type
export type ErrorPayload = typeof errorPayloadSchema.Type
