import { Result, Schema } from 'effect'
import { isValidProductId } from '../domain/listing.js'

/**
 * Tolerant boundary schema for the signed-in wishlist. The list is one array at
 * `data.storeWishlistSecure`. Entries decode one by one, so a malformed element
 * never drops its neighbours. Scope is default-drop: an entry is kept only when
 * its platforms contain `PS5`, its name is not empty, and its id is valid for
 * its `__typename`.
 */
const envelopeSchema = Schema.Struct({
  data: Schema.Struct({
    storeWishlistSecure: Schema.Array(Schema.Unknown),
  }),
})

const accessDeniedSchema = Schema.Struct({
  errors: Schema.Array(
    Schema.Struct({ message: Schema.optional(Schema.NullOr(Schema.String)) }),
  ),
  data: Schema.Struct({ storeWishlistSecure: Schema.Null }),
})

const boxArtSchema = Schema.Struct({
  url: Schema.optional(Schema.NullOr(Schema.String)),
})

const entrySchema = Schema.Struct({
  __typename: Schema.optional(Schema.NullOr(Schema.String)),
  id: Schema.optional(Schema.NullOr(Schema.String)),
  name: Schema.optional(Schema.NullOr(Schema.String)),
  platforms: Schema.optional(Schema.NullOr(Schema.Array(Schema.Unknown))),
  boxArt: Schema.optional(Schema.NullOr(Schema.Unknown)),
})

export interface WishlistEntry {
  readonly id: string
  readonly idKind: 'product' | 'concept'
  readonly name: string
  readonly imageUrl: string
}

export type WishlistOutcome =
  // Sony answered "access denied" and returned no list.
  | { readonly kind: 'denied' }
  | { readonly kind: 'drift' }
  | {
      readonly kind: 'ok'
      // Entries Sony returned, before any scope filter.
      readonly rawCount: number
      readonly entries: readonly WishlistEntry[]
      // Elements that failed decode or lacked a usable id or name.
      readonly dropped: number
      // Decoded elements outside the product scope (platform, type or id).
      readonly outOfScope: number
    }

const decodeEnvelope = Schema.decodeUnknownResult(envelopeSchema)
const decodeAccessDenied = Schema.decodeUnknownResult(accessDeniedSchema)
const decodeEntry = Schema.decodeUnknownResult(entrySchema)
const decodeBoxArt = Schema.decodeUnknownResult(boxArtSchema)

const CONCEPT_ID_PATTERN = /^\d+$/

const isAccessDenied = (json: unknown): boolean => {
  const decoded = decodeAccessDenied(json)
  return (
    Result.isSuccess(decoded) &&
    decoded.success.errors.some((error) =>
      (error.message ?? '').toLowerCase().includes('access denied'),
    )
  )
}

const idKindOf = (typename: string | null | undefined, id: string) => {
  if (typename === 'Product' && isValidProductId(id)) {
    return 'product' as const
  }
  if (typename === 'Concept' && CONCEPT_ID_PATTERN.test(id)) {
    return 'concept' as const
  }
  return null
}

const imageUrlOf = (boxArt: unknown): string => {
  const decoded = decodeBoxArt(boxArt)
  return Result.isSuccess(decoded) ? (decoded.success.url ?? '') : ''
}

export const parseWishlist = (json: unknown): WishlistOutcome => {
  const envelope = decodeEnvelope(json)
  if (Result.isFailure(envelope)) {
    return isAccessDenied(json) ? { kind: 'denied' } : { kind: 'drift' }
  }

  const rawEntries = envelope.success.data.storeWishlistSecure
  const entries: WishlistEntry[] = []
  const seen = new Set<string>()
  let dropped = 0
  let outOfScope = 0

  for (const rawEntry of rawEntries) {
    const decoded = decodeEntry(rawEntry)
    const entry = Result.isSuccess(decoded) ? decoded.success : null
    const id = entry?.id
    const name = entry?.name
    if (
      entry === null ||
      typeof id !== 'string' ||
      id === '' ||
      typeof name !== 'string' ||
      name === ''
    ) {
      dropped += 1
      continue
    }
    const idKind = idKindOf(entry.__typename, id)
    if (idKind === null || !(entry.platforms ?? []).includes('PS5')) {
      outOfScope += 1
      continue
    }
    if (seen.has(id)) {
      continue
    }
    seen.add(id)
    entries.push({ id, idKind, name, imageUrl: imageUrlOf(entry.boxArt) })
  }

  return {
    kind: 'ok',
    rawCount: rawEntries.length,
    entries,
    dropped,
    outOfScope,
  }
}
