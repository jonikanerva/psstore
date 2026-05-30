import { Schema } from 'effect'

// Path / query parameter schemas for the HttpApi endpoints (api/gamesApi.ts).
// URL params arrive as strings, so numeric fields decode from string
// (`NumberFromString`) with the same bounds/defaults as the previous zod
// schemas: offset ≥ 0 default 0; size in [1, 120] default 60.

export const gameIdParamSchema = Schema.Struct({
  id: Schema.Trim.pipe(Schema.minLength(1)),
})

const offsetFromString = Schema.NumberFromString.pipe(
  Schema.int(),
  Schema.greaterThanOrEqualTo(0),
)

const sizeFromString = Schema.NumberFromString.pipe(
  Schema.int(),
  Schema.greaterThanOrEqualTo(1),
  Schema.lessThanOrEqualTo(120),
)

export const paginationQuerySchema = Schema.Struct({
  offset: Schema.optionalWith(offsetFromString, { default: () => 0 }),
  size: Schema.optionalWith(sizeFromString, { default: () => 60 }),
})
