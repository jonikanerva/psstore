import { z } from 'zod'

export const gameSchema = z.object({
  id: z.string(),
  name: z.string(),
  date: z.string(),
  url: z.string(),
  price: z.string(),
  originalPrice: z.string(),
  discountText: z.string(),
  discountDate: z.string(),
  screenshots: z.array(z.string()),
  videos: z.array(z.string()),
  genres: z.array(z.string()),
  description: z.string(),
  studio: z.string(),
  preOrder: z.boolean()
})

export const gamesSchema = z.array(gameSchema)

export const errorPayloadSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string()
  })
})
