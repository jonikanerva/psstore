import { z } from 'zod';
export declare const gameSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    date: z.ZodString;
    url: z.ZodString;
    price: z.ZodString;
    discountDate: z.ZodString;
    screenshots: z.ZodArray<z.ZodString, "many">;
    videos: z.ZodArray<z.ZodString, "many">;
    genres: z.ZodArray<z.ZodString, "many">;
    description: z.ZodString;
    studio: z.ZodString;
    preOrder: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    id: string;
    name: string;
    date: string;
    url: string;
    price: string;
    discountDate: string;
    screenshots: string[];
    videos: string[];
    genres: string[];
    description: string;
    studio: string;
    preOrder: boolean;
}, {
    id: string;
    name: string;
    date: string;
    url: string;
    price: string;
    discountDate: string;
    screenshots: string[];
    videos: string[];
    genres: string[];
    description: string;
    studio: string;
    preOrder: boolean;
}>;
export declare const gamesSchema: z.ZodArray<z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    date: z.ZodString;
    url: z.ZodString;
    price: z.ZodString;
    discountDate: z.ZodString;
    screenshots: z.ZodArray<z.ZodString, "many">;
    videos: z.ZodArray<z.ZodString, "many">;
    genres: z.ZodArray<z.ZodString, "many">;
    description: z.ZodString;
    studio: z.ZodString;
    preOrder: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    id: string;
    name: string;
    date: string;
    url: string;
    price: string;
    discountDate: string;
    screenshots: string[];
    videos: string[];
    genres: string[];
    description: string;
    studio: string;
    preOrder: boolean;
}, {
    id: string;
    name: string;
    date: string;
    url: string;
    price: string;
    discountDate: string;
    screenshots: string[];
    videos: string[];
    genres: string[];
    description: string;
    studio: string;
    preOrder: boolean;
}>, "many">;
export declare const errorPayloadSchema: z.ZodObject<{
    error: z.ZodObject<{
        code: z.ZodString;
        message: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        code: string;
        message: string;
    }, {
        code: string;
        message: string;
    }>;
}, "strip", z.ZodTypeAny, {
    error: {
        code: string;
        message: string;
    };
}, {
    error: {
        code: string;
        message: string;
    };
}>;
