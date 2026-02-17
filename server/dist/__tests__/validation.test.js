import { describe, expect, it } from 'vitest';
import { searchQuerySchema } from '../validation/schemas.js';
describe('searchQuerySchema', () => {
    it('rejects missing q', () => {
        const result = searchQuerySchema.safeParse({});
        expect(result.success).toBe(false);
    });
});
