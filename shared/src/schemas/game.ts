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
  preOrder: z.boolean(),
  plusUpsellText: z.string().nullable(),
  // `product` → internal product SKU with a PDP and (usually) a price;
  // `concept` → an announced UPCOMING title Sony does not yet expose as a
  // priced SKU anonymously. The default keeps every existing producer
  // (NEW / DISCOUNTED, caches, fixtures) parsing as `product` unchanged; only
  // the UPCOMING concept-card path sets `concept`. See gamesService.ts.
  idKind: z.enum(['product', 'concept']).default('product')
})

export const gamesSchema = z.array(gameSchema)

export const pageResultSchema = z.object({
  games: z.array(gameSchema),
  totalCount: z.number(),
  nextOffset: z.number().nullable(),
})

export const errorPayloadSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string()
  })
})
