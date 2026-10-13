export const SEARCH_TERM_MAX_LENGTH = 100

// The submitted term: trimmed, then capped at the server limit.
export const normalizeSearchTerm = (value: string): string =>
  value.trim().slice(0, SEARCH_TERM_MAX_LENGTH)

// Reads `q` from an untrusted location search record. A missing or non-string
// value reads as the empty term.
export const readSearchTerm = (search: unknown): string => {
  if (typeof search !== 'object' || search === null) {
    return ''
  }
  const q: unknown = Reflect.get(search, 'q')
  return typeof q === 'string' ? normalizeSearchTerm(q) : ''
}

// The router reads and writes every search value as a plain string. The
// default JSON codec would turn a term such as `2077` into a number.
export const parseSearch = (search: string): Record<string, string> =>
  Object.fromEntries(new URLSearchParams(search))

export const stringifySearch = (search: Record<string, unknown>): string => {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(search)) {
    if (typeof value === 'string') {
      params.set(key, value)
    }
  }
  const text = params.toString()
  return text === '' ? '' : `?${text}`
}
