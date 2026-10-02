import { Effect, Schema } from 'effect'

// Path / query parameter schemas for the HttpApi endpoints (api/gamesApi.ts).
// URL params arrive as strings, so numeric fields decode from string
// (`NumberFromString`) with the same bounds/defaults as the previous zod
// schemas: offset ≥ 0 default 0; size in [1, 120] default 60.

export const gameIdParamSchema = Schema.Struct({
  id: Schema.Trim.check(Schema.isMinLength(1)),
})

const offsetFromString = Schema.NumberFromString.check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
)

const sizeFromString = Schema.NumberFromString.check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(1),
  Schema.isLessThanOrEqualTo(120),
)

export const paginationQuerySchema = Schema.Struct({
  offset: offsetFromString.pipe(
    Schema.optional,
    Schema.withDecodingDefaultType(Effect.succeed(0)),
  ),
  size: sizeFromString.pipe(
    Schema.optional,
    Schema.withDecodingDefaultType(Effect.succeed(60)),
  ),
})
