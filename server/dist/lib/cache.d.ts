export declare class MemoryCache {
    private readonly store;
    get<T>(key: string): T | undefined;
    set<T>(key: string, value: T, ttlMs: number): void;
}
