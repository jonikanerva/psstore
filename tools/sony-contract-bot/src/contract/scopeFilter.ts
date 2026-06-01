import type { ContractOperation } from './types.js'

const includesPs5 = (value: unknown): boolean => {
  if (typeof value === 'string') {
    return value.toUpperCase().includes('PS5')
  }

  if (Array.isArray(value)) {
    return value.some((entry) => includesPs5(entry))
  }

  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some((entry) =>
      includesPs5(entry),
    )
  }

  return false
}

// Closed deny-list of non-PS5 PlayStation platform tokens. The PDP operation
// (`metGetProductById`) is product-id-addressed: its variables are exactly
// `{ productId }` and carry NO platform token, so `includesPs5` is false for it
// and a PS5-token *requirement* would wrongly drop it. Scope for product-id ops
// is therefore enforced by REJECTING an explicit out-of-scope platform, not by
// requiring the PS5 token (see `platformOk` below). Tokens are matched as
// boundary-delimited words (uppercased) to avoid false substring hits — e.g.
// `PS4` must not match inside a longer alphanumeric run. This list is the only
// place that knows the out-of-scope platforms; extend it, don't fork it.
const NON_PS5_PLATFORM_TOKENS = ['PS4', 'PS3', 'PSVITA', 'PSP'] as const

const includesOtherPlatform = (value: unknown): boolean => {
  if (typeof value === 'string') {
    const upper = value.toUpperCase()
    return NON_PS5_PLATFORM_TOKENS.some((token) => {
      // Word-boundary match (token not flanked by another alphanumeric char) so
      // `PS4` is found in `targetPlatforms:PS4` / `["PS4"]` but never inside an
      // unrelated longer alphanumeric token.
      const pattern = new RegExp(`(^|[^A-Z0-9])${token}([^A-Z0-9]|$)`)
      return pattern.test(upper)
    })
  }

  if (Array.isArray(value)) {
    return value.some((entry) => includesOtherPlatform(entry))
  }

  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some((entry) =>
      includesOtherPlatform(entry),
    )
  }

  return false
}

const includesEur = (value: unknown): boolean => {
  if (typeof value === 'string') {
    return value.toUpperCase().includes('EUR') || value.includes('€')
  }

  if (Array.isArray(value)) {
    return value.some((entry) => includesEur(entry))
  }

  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some((entry) =>
      includesEur(entry),
    )
  }

  return false
}

const includesFiFi = (value: unknown): boolean => {
  if (typeof value === 'string') {
    return value.toLowerCase().includes('fi-fi')
  }

  if (Array.isArray(value)) {
    return value.some((entry) => includesFiFi(entry))
  }

  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some((entry) =>
      includesFiFi(entry),
    )
  }

  return false
}

const includesValue = (value: unknown, needle: string): boolean => {
  if (typeof value === 'string') {
    return value.toLowerCase().includes(needle.toLowerCase())
  }

  if (Array.isArray(value)) {
    return value.some((entry) => includesValue(entry, needle))
  }

  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some((entry) =>
      includesValue(entry, needle),
    )
  }

  return false
}

export const filterOperationsByFinnishPs5EurScope = (
  operations: ContractOperation[],
): ContractOperation[] =>
  operations.filter((operation) => {
    const bundle = {
      ...operation.variables_schema,
      ...operation.sample_variables,
    }

    const localeOk = includesFiFi(bundle) || !includesValue(bundle, 'en-us')
    // why: keep an op if it carries the PS5 token (the grid ops) OR carries no
    // out-of-scope platform token at all (the product-id-addressed PDP op, whose
    // variables are just `{ productId }`). PDP scope is NOT enforced here — it
    // rests on the hard-coded evergreen product id in the capture route plus the
    // server's `productDetailSchema` narrowing; a future reader must not trust
    // this filter to catch a mis-pointed PDP route.
    const platformOk = includesPs5(bundle) || !includesOtherPlatform(bundle)
    const currencyOk = includesEur(bundle) || !includesValue(bundle, 'usd')

    return localeOk && platformOk && currencyOk
  })
