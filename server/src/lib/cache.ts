interface CacheEntry<T> {
  value: T
  expiresAt: number
}

export class MemoryCache {
  private readonly store = new Map<string, CacheEntry<unknown>>()

  get<T>(key: string): T | undefined {
    const cached = this.store.get(key)
    if (!cached) {
      return undefined
    }

    if (cached.expiresAt < Date.now()) {
      this.store.delete(key)
      return undefined
    }

    return cached.value as T
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs })
  }
}
