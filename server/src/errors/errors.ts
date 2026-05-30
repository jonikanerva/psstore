import { Schema } from 'effect'

// Typed errors live in the Effect error channel; the HttpApi endpoint maps each
// to its HTTP status via `.addError(Error, { status })` (see api/gamesApi.ts).
// No hand-rolled error-to-response glue (STACK.md §8).

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
