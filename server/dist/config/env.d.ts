import { z } from 'zod';
declare const envSchema: z.ZodObject<{
    NODE_ENV: z.ZodDefault<z.ZodEnum<["development", "test", "production"]>>;
    PORT: z.ZodDefault<z.ZodNumber>;
    SONY_GRAPHQL_URL: z.ZodDefault<z.ZodString>;
    SONY_CATEGORY_GRID_HASH: z.ZodDefault<z.ZodString>;
    SONY_CATEGORY_ID: z.ZodDefault<z.ZodString>;
    SONY_OPERATION_NAME: z.ZodDefault<z.ZodString>;
    SONY_LOCALE: z.ZodDefault<z.ZodString>;
    SONY_RETRY_COUNT: z.ZodDefault<z.ZodNumber>;
    SONY_TIMEOUT_MS: z.ZodDefault<z.ZodNumber>;
    CACHE_TTL_MS: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    NODE_ENV: "development" | "test" | "production";
    PORT: number;
    SONY_GRAPHQL_URL: string;
    SONY_CATEGORY_GRID_HASH: string;
    SONY_CATEGORY_ID: string;
    SONY_OPERATION_NAME: string;
    SONY_LOCALE: string;
    SONY_RETRY_COUNT: number;
    SONY_TIMEOUT_MS: number;
    CACHE_TTL_MS: number;
}, {
    NODE_ENV?: "development" | "test" | "production" | undefined;
    PORT?: number | undefined;
    SONY_GRAPHQL_URL?: string | undefined;
    SONY_CATEGORY_GRID_HASH?: string | undefined;
    SONY_CATEGORY_ID?: string | undefined;
    SONY_OPERATION_NAME?: string | undefined;
    SONY_LOCALE?: string | undefined;
    SONY_RETRY_COUNT?: number | undefined;
    SONY_TIMEOUT_MS?: number | undefined;
    CACHE_TTL_MS?: number | undefined;
}>;
export type Env = z.infer<typeof envSchema>;
export declare const env: {
    NODE_ENV: "development" | "test" | "production";
    PORT: number;
    SONY_GRAPHQL_URL: string;
    SONY_CATEGORY_GRID_HASH: string;
    SONY_CATEGORY_ID: string;
    SONY_OPERATION_NAME: string;
    SONY_LOCALE: string;
    SONY_RETRY_COUNT: number;
    SONY_TIMEOUT_MS: number;
    CACHE_TTL_MS: number;
};
export {};
