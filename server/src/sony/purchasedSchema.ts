import { Result, Schema } from 'effect'
import { isValidProductId } from '../domain/listing.js'

/**
 * Tolerant boundary schema for one page of the signed-in library list. The
 * envelope must be `data.purchasedTitlesRetrieve.games`; any other shape is
 * drift. Games decode one by one, so a malformed element never drops its
 * neighbours. Scope is default-drop: an entry is kept only when its platform is
 * exactly `PS5`, its name is not empty, and its product id is valid.
 */
const envelopeSchema = Schema.Struct({
  data: Schema.Struct({
    purchasedTitlesRetrieve: Schema.Struct({
      games: Schema.Array(Schema.Unknown),
    }),
  }),
})

const entrySchema = Schema.Struct({
  productId: Schema.optional(Schema.NullOr(Schema.String)),
  name: Schema.optional(Schema.NullOr(Schema.String)),
  platform: Schema.optional(Schema.NullOr(Schema.String)),
  image: Schema.optional(
    Schema.NullOr(
      Schema.Struct({ url: Schema.optional(Schema.NullOr(Schema.String)) }),
    ),
  ),
})

export interface PurchasedEntry {
  readonly productId: string
  readonly name: string
  readonly imageUrl: string
}

export type PurchasedPageOutcome =
  | { readonly kind: 'drift' }
  | {
      readonly kind: 'ok'
      // Games Sony returned on this page, before any scope filter. The crawl
      // compares it with the requested page size to find the last page.
      readonly rawCount: number
      readonly entries: readonly PurchasedEntry[]
      // Elements that failed decode or lacked a usable id or name.
      readonly dropped: number
      // Decoded elements outside the product scope (platform or id).
      readonly outOfScope: number
    }

const decodeEnvelope = Schema.decodeUnknownResult(envelopeSchema)
const decodeEntry = Schema.decodeUnknownResult(entrySchema)

export const parsePurchasedPage = (json: unknown): PurchasedPageOutcome => {
  const envelope = decodeEnvelope(json)
  if (Result.isFailure(envelope)) {
    return { kind: 'drift' }
  }

  const rawGames = envelope.success.data.purchasedTitlesRetrieve.games
  const entries: PurchasedEntry[] = []
  let dropped = 0
  let outOfScope = 0

  for (const rawGame of rawGames) {
    const decoded = decodeEntry(rawGame)
    const game = Result.isSuccess(decoded) ? decoded.success : null
    const productId = game?.productId
    const name = game?.name
    if (
      game === null ||
      typeof productId !== 'string' ||
      typeof name !== 'string' ||
      name === ''
    ) {
      dropped += 1
      continue
    }
    if (game.platform !== 'PS5' || !isValidProductId(productId)) {
      outOfScope += 1
      continue
    }
    entries.push({
      productId,
      name,
      imageUrl: game.image?.url ?? '',
    })
  }

  return {
    kind: 'ok',
    rawCount: rawGames.length,
    entries,
    dropped,
    outOfScope,
  }
}

/** Keep the first entry per product id, preserving Sony's order. */
export const dedupePurchased = (
  entries: readonly PurchasedEntry[],
): PurchasedEntry[] => {
  const seen = new Set<string>()
  const unique: PurchasedEntry[] = []
  for (const entry of entries) {
    if (!seen.has(entry.productId)) {
      seen.add(entry.productId)
      unique.push(entry)
    }
  }
  return unique
}
