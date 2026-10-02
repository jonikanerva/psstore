import { Schema } from 'effect'

// Typed errors live in the Effect error channel; the HttpApi endpoint maps each
// to its HTTP status (see api/gamesApi.ts). No hand-rolled error-to-response
// glue (STACK.md §8).

export class GameNotFound extends Schema.TaggedError<GameNotFound>()(
  'GameNotFound',
  { id: Schema.String },
) {}

export class ValidationError extends Schema.TaggedError<ValidationError>()(
  'ValidationError',
  { message: Schema.String },
) {}

export class UpstreamUnavailable extends Schema.TaggedError<UpstreamUnavailable>()(
  'UpstreamUnavailable',
  { message: Schema.String },
) {}

// Sony returns HTTP 200 + a top-level GraphQL `errors[]` array when a persisted
// query hash no longer matches its store build (Apollo `PERSISTED_QUERY_NOT_FOUND`).
// Distinct from a generic outage: the operator's fix is to re-capture the hash
// constants via `pnpm sony:refresh`. Mapped to HTTP 502 (see api/gamesApi.ts).
export class UpstreamQueryRotated extends Schema.TaggedError<UpstreamQueryRotated>()(
  'UpstreamQueryRotated',
  { message: Schema.String, operationName: Schema.String },
) {}

// Sony answered 429 and we exhausted the single retry budget. Distinct from a
// generic outage so the surface can back off honestly. `retryAfterSeconds`
// carries the upstream `Retry-After` when present. Mapped to HTTP 503.
export class UpstreamRateLimited extends Schema.TaggedError<UpstreamRateLimited>()(
  'UpstreamRateLimited',
  { message: Schema.String, retryAfterSeconds: Schema.optional(Schema.Number) },
) {}
