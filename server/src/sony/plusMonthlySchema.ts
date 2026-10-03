import { Result, Schema } from 'effect'
import { isValidProductId } from '../domain/listing.js'
import { decodeHtmlEntities } from './htmlEntities.js'

/**
 * Tolerant boundary schema for the PS Plus monthly games feed: a list of
 * alphabetical buckets, each holding game entries. Every field is
 * `optional(NullOr(...))`, unknown keys are ignored, and buckets and entries
 * decode one by one so a malformed element never drops its neighbours.
 */
const bucketSchema = Schema.Struct({
  games: Schema.optional(Schema.NullOr(Schema.Array(Schema.Unknown))),
})

const entrySchema = Schema.Struct({
  productId: Schema.optional(Schema.NullOr(Schema.String)),
  name: Schema.optional(Schema.NullOr(Schema.String)),
  imageUrl: Schema.optional(Schema.NullOr(Schema.String)),
  releaseDate: Schema.optional(Schema.NullOr(Schema.String)),
  genre: Schema.optional(
    Schema.NullOr(Schema.Array(Schema.NullOr(Schema.String))),
  ),
  device: Schema.optional(
    Schema.NullOr(Schema.Array(Schema.NullOr(Schema.String))),
  ),
})

export interface PlusMonthlyEntry {
  readonly productId: string
  readonly name: string
  readonly imageUrl: string
  readonly releaseDate: string
  readonly genres: readonly string[]
}

export type PlusMonthlyOutcome =
  | { readonly kind: 'drift' }
  | {
      readonly kind: 'ok'
      readonly entries: readonly PlusMonthlyEntry[]
      // Elements that failed decode or lacked an id or name.
      readonly dropped: number
      // Decoded entries skipped: `device` lacks PS5, or the id is not a valid product id.
      readonly outOfScope: number
    }

const decodeBuckets = Schema.decodeUnknownResult(Schema.Array(Schema.Unknown))
const decodeBucket = Schema.decodeUnknownResult(bucketSchema)
const decodeEntry = Schema.decodeUnknownResult(entrySchema)

const strings = (
  values: readonly (string | null)[] | null | undefined,
): string[] =>
  (values ?? []).filter(
    (value): value is string => typeof value === 'string' && value !== '',
  )

/**
 * Flatten the buckets and keep entries whose `device` includes PS5 and whose id is a valid product id. The first
 * entry per product id wins. A body that is not a list of bucket objects is
 * `drift`; a list with no usable entry is a successful empty result.
 */
export const parsePlusMonthly = (json: unknown): PlusMonthlyOutcome => {
  const buckets = decodeBuckets(json)
  if (Result.isFailure(buckets)) {
    return { kind: 'drift' }
  }

  let dropped = 0
  let outOfScope = 0
  let decodedBuckets = 0
  const seen = new Set<string>()
  const entries: PlusMonthlyEntry[] = []

  for (const rawBucket of buckets.success) {
    const bucket = decodeBucket(rawBucket)
    if (Result.isFailure(bucket)) {
      dropped += 1
      continue
    }
    decodedBuckets += 1

    for (const rawEntry of bucket.success.games ?? []) {
      const decoded = decodeEntry(rawEntry)
      const entry = Result.isSuccess(decoded) ? decoded.success : null
      const productId = entry?.productId
      const name = entry?.name
      if (
        entry === null ||
        typeof productId !== 'string' ||
        productId === '' ||
        typeof name !== 'string' ||
        name === ''
      ) {
        dropped += 1
        continue
      }

      if (
        !strings(entry.device).includes('PS5') ||
        !isValidProductId(productId)
      ) {
        outOfScope += 1
        continue
      }

      if (seen.has(productId)) {
        continue
      }
      seen.add(productId)
      entries.push({
        productId,
        name: decodeHtmlEntities(name),
        imageUrl: entry.imageUrl ?? '',
        releaseDate: entry.releaseDate ?? '',
        genres: strings(entry.genre),
      })
    }
  }

  if (buckets.success.length > 0 && decodedBuckets === 0) {
    return { kind: 'drift' }
  }

  return { kind: 'ok', entries, dropped, outOfScope }
}
