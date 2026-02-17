import { z } from 'zod'

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(100),
})

export const gameIdParamSchema = z.object({
  id: z.string().trim().min(1),
})
