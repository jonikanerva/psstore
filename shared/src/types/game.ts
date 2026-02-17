import type { z } from 'zod'
import type { gameSchema, errorPayloadSchema } from '../schemas/game.js'

export type Game = z.infer<typeof gameSchema>
export type ErrorPayload = z.infer<typeof errorPayloadSchema>
