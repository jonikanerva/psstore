import { Schema } from 'effect'

export const gameSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  date: Schema.String,
  url: Schema.String,
  price: Schema.String,
  originalPrice: Schema.String,
  discountText: Schema.String,
  discountDate: Schema.String,
  screenshots: Schema.Array(Schema.String),
  videos: Schema.Array(Schema.String),
  genres: Schema.Array(Schema.String),
  description: Schema.String,
  studio: Schema.String,
  preOrder: Schema.Boolean,
  plusUpsellText: Schema.NullOr(Schema.String),
  // `product` → internal product SKU with a PDP and (usually) a price;
  // `concept` → an announced UPCOMING title Sony does not yet expose as a
  // priced SKU anonymously. The default keeps every existing producer
  // (NEW / DISCOUNTED, caches, fixtures) decoding as `product` unchanged; only
  // the UPCOMING concept-card path sets `concept`. See gamesService.ts. The
  // default decodes to a NON-optional field — matching the previous zod
  // `.default('product')` exactly — and fires whether `idKind` is absent or
  // explicitly `undefined`.
  idKind: Schema.optionalWith(Schema.Literal('product', 'concept'), {
    default: () => 'product' as const,
  }),
})

export const gamesSchema = Schema.Array(gameSchema)

export const pageResultSchema = Schema.Struct({
  games: Schema.Array(gameSchema),
  totalCount: Schema.Number,
  nextOffset: Schema.NullOr(Schema.Number),
})

export const errorPayloadSchema = Schema.Struct({
  error: Schema.Struct({
    code: Schema.String,
    message: Schema.String,
  }),
})
