import { HttpError } from '../errors/httpError.js';
export const fetchWithRetry = async (input, init, timeoutMs, retries) => {
    let attempt = 0;
    let lastError;
    while (attempt <= retries) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetch(input, {
                ...init,
                signal: controller.signal,
            });
            clearTimeout(timer);
            if (!response.ok) {
                throw new HttpError(502, 'UPSTREAM_ERROR', `Sony upstream returned ${response.status}`);
            }
            return response;
        }
        catch (error) {
            clearTimeout(timer);
            lastError = error;
            attempt += 1;
        }
    }
    throw new HttpError(502, 'UPSTREAM_UNAVAILABLE', String(lastError ?? 'Upstream unavailable'));
};
