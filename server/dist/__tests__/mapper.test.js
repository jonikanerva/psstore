import { describe, expect, it } from 'vitest';
import { productToGame } from '../sony/mapper.js';
describe('productToGame', () => {
    it('maps sony product to app game', () => {
        const game = productToGame({
            id: 'id-1',
            name: 'Game',
            releaseDate: '2025-01-01T00:00:00Z',
            media: [{ type: 'IMAGE', role: 'MASTER', url: 'https://img' }],
            price: { basePrice: '$70', discountedPrice: '$50', discountText: 'sale' },
            genres: ['Action'],
            providerName: 'Studio',
        });
        expect(game.id).toBe('id-1');
        expect(game.url).toBe('https://img');
        expect(game.price).toBe('$50');
        expect(game.genres).toEqual(['Action']);
    });
});
