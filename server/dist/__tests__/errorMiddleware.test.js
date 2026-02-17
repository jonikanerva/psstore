import { describe, expect, it, vi } from 'vitest';
import { errorMiddleware } from '../errors/errorMiddleware.js';
import { HttpError } from '../errors/httpError.js';
describe('error middleware', () => {
    it('returns stable error payload for HttpError', () => {
        const status = vi.fn().mockReturnThis();
        const json = vi.fn();
        const response = { status, json };
        errorMiddleware(new HttpError(404, 'NOT_FOUND', 'missing'), {}, response, vi.fn());
        expect(status).toHaveBeenCalledWith(404);
        expect(json).toHaveBeenCalledWith({
            error: { code: 'NOT_FOUND', message: 'missing' },
        });
    });
});
