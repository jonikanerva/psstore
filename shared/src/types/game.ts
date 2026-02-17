import type { z } from 'zod'
import type { gameSchema, errorPayloadSchema, pageResultSchema } from '../schemas/game.js'

export type Game = z.infer<typeof gameSchema>
export type PageResult = z.infer<typeof pageResultSchema>
export type ErrorPayload = z.infer<typeof errorPayloadSchema>
