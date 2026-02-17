export interface Media {
  url?: string
  role?: string
  type?: string
}

export interface ConceptPrice {
  basePrice?: string
  discountedPrice?: string
  discountText?: string | null
  serviceBranding?: string[]
  upsellServiceBranding?: string[]
  upsellText?: string | null
}

export interface ConceptProductRef {
  id?: string
  releaseDate?: string
  providerName?: string
  genres?: string[]
}

export interface Concept {
  id?: string
  name?: string
  media?: Media[]
  price?: ConceptPrice
  products?: ConceptProductRef[]
}

export interface CategoryGridProduct {
  id?: string
  name?: string
  media?: Media[]
  price?: ConceptPrice
  platforms?: string[]
  storeDisplayClassification?: string
  npTitleId?: string
}

export interface CategoryGridRetrieveResponse {
  data?: {
    categoryGridRetrieve?: {
      concepts?: Concept[]
      products?: CategoryGridProduct[]
    }
  }
}

export interface ProductDetail {
  id?: string
  releaseDate?: string
  publisherName?: string
  genres?: string[]
  description?: string
  longDescription?: string
}

export interface ProductRetrieveResponse {
  data?: {
    productRetrieve?: ProductDetail
  }
}
