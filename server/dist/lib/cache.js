export class MemoryCache {
    store = new Map();
    get(key) {
        const cached = this.store.get(key);
        if (!cached) {
            return undefined;
        }
        if (cached.expiresAt < Date.now()) {
            this.store.delete(key);
            return undefined;
        }
        return cached.value;
    }
    set(key, value, ttlMs) {
        this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
    }
}
