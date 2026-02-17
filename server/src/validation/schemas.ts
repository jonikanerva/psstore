import { z } from 'zod'

export const gameIdParamSchema = z.object({
  id: z.string().trim().min(1),
})

export const paginationQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  size: z.coerce.number().int().min(1).max(120).default(60),
})
