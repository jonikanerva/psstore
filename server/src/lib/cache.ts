interface CacheEntry<T> {
  value: T
  expiresAt: number
}

const MAX_ENTRIES = 10_000
const SWEEP_INTERVAL_MS = 60_000

export class MemoryCache {
  private readonly store = new Map<string, CacheEntry<unknown>>()
  private sweepTimer: ReturnType<typeof setInterval> | null = null

  constructor() {
    this.sweepTimer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS)
    if (this.sweepTimer.unref) {
      this.sweepTimer.unref()
    }
  }

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

    if (this.store.size > MAX_ENTRIES) {
      this.evictOldest()
    }
  }

  destroy(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer)
      this.sweepTimer = null
    }
    this.store.clear()
  }

  private sweep(): void {
    const now = Date.now()
    for (const [key, entry] of this.store) {
      if (entry.expiresAt < now) {
        this.store.delete(key)
      }
    }
  }

  private evictOldest(): void {
    let oldestKey: string | null = null
    let oldestExpiry = Infinity

    for (const [key, entry] of this.store) {
      if (entry.expiresAt < oldestExpiry) {
        oldestExpiry = entry.expiresAt
        oldestKey = key
      }
    }

    if (oldestKey) {
      this.store.delete(oldestKey)
    }
  }
}
