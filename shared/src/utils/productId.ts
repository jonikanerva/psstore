const PRODUCT_ID_PATTERN = /^[A-Z]{2}\d{4}-[A-Z]{4}\d{5}_00-/

// True for a Sony product SKU id; a concept id (digits only) never matches.
export const isValidProductId = (id: string): boolean =>
  PRODUCT_ID_PATTERN.test(id)
