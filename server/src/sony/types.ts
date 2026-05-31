// Category-grid value types are derived from the Effect Schema boundary
// (categoryGridSchema.ts) and re-exported here under their canonical names, so
// the decoder and the value types stay in lockstep (a drift is a compile error
// — STACK.md §2). The product-detail value types below remain hand-written and
// pair with productDetailSchema.ts.
export type {
  CategoryGridProduct,
  Concept,
  ConceptPrice,
  ConceptProductRef,
  Media,
} from './categoryGridSchema.js'

export interface SonyDescription {
  type?: string | undefined
  subType?: string | null | undefined
  value?: string | undefined
}

export interface SonyLocalizedGenre {
  value?: string | undefined
}

export interface ProductDetail {
  id?: string | undefined
  releaseDate?: string | undefined
  publisherName?: string | undefined
  storeDisplayClassification?: string | undefined
  descriptions?: SonyDescription[] | undefined
  combinedLocalizedGenres?: SonyLocalizedGenre[] | undefined
}

export interface ProductRetrieveResponse {
  data?:
    | {
        productRetrieve?: ProductDetail | undefined
      }
    | undefined
}
