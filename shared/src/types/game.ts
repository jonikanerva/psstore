import type { gameSchema, errorPayloadSchema, pageResultSchema } from '../schemas/game.js'

export type Game = typeof gameSchema.Type
export type PageResult = typeof pageResultSchema.Type
export type ErrorPayload = typeof errorPayloadSchema.Type
