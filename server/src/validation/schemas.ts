import { z } from 'zod'

export const gameIdParamSchema = z.object({
  id: z.string().trim().min(1),
})
