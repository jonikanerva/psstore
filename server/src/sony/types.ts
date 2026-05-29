export interface Media {
  url?: string | undefined
  role?: string | undefined
  type?: string | undefined
}

export interface ConceptPrice {
  basePrice?: string | undefined
  discountedPrice?: string | undefined
  discountText?: string | null | undefined
  serviceBranding?: string[] | undefined
  upsellServiceBranding?: string[] | undefined
  upsellText?: string | null | undefined
}

export interface ConceptProductRef {
  id?: string | undefined
  releaseDate?: string | undefined
  providerName?: string | undefined
  genres?: string[] | undefined
}

export interface Concept {
  id?: string | undefined
  name?: string | undefined
  media?: Media[] | undefined
  price?: ConceptPrice | undefined
  products?: ConceptProductRef[] | undefined
}

export interface CategoryGridProduct {
  id?: string | undefined
  name?: string | undefined
  media?: Media[] | undefined
  price?: ConceptPrice | undefined
  platforms?: string[] | undefined
  storeDisplayClassification?: string | undefined
  npTitleId?: string | undefined
}

export interface CategoryGridRetrieveResponse {
  data?:
    | {
        categoryGridRetrieve?:
          | {
              concepts?: Concept[] | undefined
              products?: CategoryGridProduct[] | undefined
            }
          | undefined
      }
    | undefined
}

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
