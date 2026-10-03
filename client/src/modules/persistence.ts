// Only anonymous Sony payloads reach localStorage. Every other key, the
// signed-in `purchased` list included, stays in memory.
const PERSISTED_QUERY_KEYS: ReadonlySet<unknown> = new Set(['games', 'game'])

export const shouldPersistQuery = (queryKey: readonly unknown[]): boolean =>
  PERSISTED_QUERY_KEYS.has(queryKey[0])
