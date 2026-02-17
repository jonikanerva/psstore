import { ZodError } from 'zod';
import { HttpError } from './httpError.js';
export const errorMiddleware = (error, _request, response, next) => {
    void next;
    if (error instanceof HttpError) {
        response.status(error.status).json({
            error: {
                code: error.code,
                message: error.message,
            },
        });
        return;
    }
    if (error instanceof ZodError) {
        response.status(400).json({
            error: {
                code: 'VALIDATION_ERROR',
                message: error.issues[0]?.message ?? 'Validation failed',
            },
        });
        return;
    }
    response.status(500).json({
        error: {
            code: 'INTERNAL_ERROR',
            message: 'Unexpected server error',
        },
    });
};
