import { Result, Schema } from 'effect'

/**
 * Effect Schema boundary schema for Sony's `data.categoryGridRetrieve` node
 * (operation `categoryGridRetrieve`, used by the NEW / UPCOMING / DISCOUNTED
 * list features).
 *
 * Deliberately tolerant (STACK.md scope-at-the-boundary; this is a DEFENSIVE
 * boundary, not the scope filter), mirroring `productDetailSchema.ts`: every
 * field is `optional(NullOr(...))` — it accepts an absent key, an explicit
 * `null`, OR the typed value — and unknown keys are ignored
 * (never an error). Sony sends `null` liberally
 * (e.g. the whole `concept.price` on an unpriced/announced UPCOMING game,
 * `price.serviceBranding` on some DISCOUNTED products); a plain `optional`
 * rejects a present `null` and — because `Schema.Array` fails wholesale on one
 * bad element — a single null-bearing item would empty the entire list. Decode
 * is therefore both null-tolerant AND per-element (see `parseCategoryGrid`), so
 * one odd item is dropped, not the whole grid (VISION continuity over blankness
 * at element granularity). Do NOT tighten this.
 */
const mediaSchema = Schema.Struct({
  url: Schema.optional(Schema.NullOr(Schema.String)),
  role: Schema.optional(Schema.NullOr(Schema.String)),
  type: Schema.optional(Schema.NullOr(Schema.String)),
})

const conceptPriceSchema = Schema.Struct({
  basePrice: Schema.optional(Schema.NullOr(Schema.String)),
  discountedPrice: Schema.optional(Schema.NullOr(Schema.String)),
  discountText: Schema.optional(Schema.NullOr(Schema.String)),
  serviceBranding: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
  upsellServiceBranding: Schema.optional(
    Schema.NullOr(Schema.Array(Schema.String)),
  ),
  upsellText: Schema.optional(Schema.NullOr(Schema.String)),
})

const conceptProductRefSchema = Schema.Struct({
  id: Schema.optional(Schema.NullOr(Schema.String)),
  releaseDate: Schema.optional(Schema.NullOr(Schema.String)),
  providerName: Schema.optional(Schema.NullOr(Schema.String)),
  genres: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
})

const conceptSchema = Schema.Struct({
  id: Schema.optional(Schema.NullOr(Schema.String)),
  name: Schema.optional(Schema.NullOr(Schema.String)),
  media: Schema.optional(Schema.NullOr(Schema.Array(mediaSchema))),
  price: Schema.optional(Schema.NullOr(conceptPriceSchema)),
  products: Schema.optional(
    Schema.NullOr(Schema.Array(conceptProductRefSchema)),
  ),
})

const categoryGridProductSchema = Schema.Struct({
  id: Schema.optional(Schema.NullOr(Schema.String)),
  name: Schema.optional(Schema.NullOr(Schema.String)),
  media: Schema.optional(Schema.NullOr(Schema.Array(mediaSchema))),
  price: Schema.optional(Schema.NullOr(conceptPriceSchema)),
  platforms: Schema.optional(Schema.NullOr(Schema.Array(Schema.String))),
  storeDisplayClassification: Schema.optional(Schema.NullOr(Schema.String)),
  npTitleId: Schema.optional(Schema.NullOr(Schema.String)),
})

// The node shape used only for type derivation. The runtime decode is
// per-element (below), but the *value types* the rest of the server reads are
// still the element schemas' `.Type`, re-exported from `types.ts`.
export const categoryGridRetrieveSchema = Schema.Struct({
  concepts: Schema.optional(Schema.NullOr(Schema.Array(conceptSchema))),
  products: Schema.optional(
    Schema.NullOr(Schema.Array(categoryGridProductSchema)),
  ),
})

/**
 * The decoded `categoryGridRetrieve` node and its element shapes. These are the
 * single source of truth for the category-grid value types: `types.ts`
 * re-exports them under the canonical `Concept` / `CategoryGridProduct` / `Media`
 * / `ConceptPrice` / `ConceptProductRef` names, so the decoder and the value
 * types can never drift (a mismatch is a compile error — STACK.md §2). Fields
 * widen with `| null`; consumers coalesce null away (see the mapper).
 */
export type CategoryGridNode = typeof categoryGridRetrieveSchema.Type
export type Media = typeof mediaSchema.Type
export type ConceptPrice = typeof conceptPriceSchema.Type
export type ConceptProductRef = typeof conceptProductRefSchema.Type
export type Concept = typeof conceptSchema.Type
export type CategoryGridProduct = typeof categoryGridProductSchema.Type

// Raw outer node: the two arrays may be absent, null, or arrays of *unknown*
// elements. Element-level validation happens after this, so one bad element
// can be dropped instead of failing the whole array.
const categoryGridRawSchema = Schema.Struct({
  concepts: Schema.optional(Schema.NullOr(Schema.Array(Schema.Unknown))),
  products: Schema.optional(Schema.NullOr(Schema.Array(Schema.Unknown))),
})

const decodeRaw = Schema.decodeUnknownResult(categoryGridRawSchema)
const decodeConcept = Schema.decodeUnknownResult(conceptSchema)
const decodeProduct = Schema.decodeUnknownResult(categoryGridProductSchema)

/**
 * Result of a per-element category-grid decode. `dropped` counts elements that
 * individually failed to decode (and were skipped) so the caller can emit one
 * element-drift signal without emptying the list.
 */
export interface ParsedCategoryGrid {
  readonly concepts: Concept[]
  readonly products: CategoryGridProduct[]
  readonly dropped: number
}

const decodeEach = <A>(
  items: ReadonlyArray<unknown>,
  decode: (value: unknown) => Result.Result<A, unknown>,
): { kept: A[]; dropped: number } => {
  const kept: A[] = []
  let dropped = 0
  for (const item of items) {
    const result = decode(item)
    if (Result.isSuccess(result)) {
      kept.push(result.success)
    } else {
      dropped += 1
    }
  }
  return { kept, dropped }
}

/**
 * Parse the `categoryGridRetrieve` node defensively and per-element. Returns
 * `null` only when the node is absent or its outer shape is unintelligible
 * (e.g. `concepts` is neither an array, null, nor absent) — the caller treats
 * that as top-level drift (degrade to `[]` + warn). Otherwise returns the kept
 * concepts/products with a `dropped` count; a non-zero `dropped` is the caller's
 * signal to log an element-drift warning while still returning the good items.
 */
export const parseCategoryGrid = (node: unknown): ParsedCategoryGrid | null => {
  if (node === null || node === undefined) {
    return null
  }

  const raw = decodeRaw(node)
  if (Result.isFailure(raw)) {
    return null
  }

  const conceptResults = decodeEach(raw.success.concepts ?? [], (value) =>
    decodeConcept(value),
  )
  const productResults = decodeEach(raw.success.products ?? [], (value) =>
    decodeProduct(value),
  )

  return {
    concepts: conceptResults.kept,
    products: productResults.kept,
    dropped: conceptResults.dropped + productResults.dropped,
  }
}

/**
 * Zero-cast envelope decode for the category-grid response. Mirrors the shape
 * `{ data?: { categoryGridRetrieve?: unknown } }` defensively (all optional,
 * excess keys ignored) so the untrusted body is narrowed before the inner node
 * is read, with no cast.
 *
 * Returns the inner `categoryGridRetrieve` value as `unknown` (or `undefined`
 * when absent / the body is not an object); the caller hands it to
 * `parseCategoryGrid`.
 */
const envelopeSchema = Schema.Struct({
  data: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        categoryGridRetrieve: Schema.optional(Schema.Unknown),
      }),
    ),
  ),
})

const decodeEnvelope = Schema.decodeUnknownResult(envelopeSchema)

export const extractCategoryGridNode = (json: unknown): unknown => {
  const result = decodeEnvelope(json)
  return Result.isSuccess(result)
    ? result.success.data?.categoryGridRetrieve
    : undefined
}
