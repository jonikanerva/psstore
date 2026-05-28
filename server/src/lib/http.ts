import { HttpError } from '../errors/httpError.js'

const describeError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'string') {
    return error
  }
  return 'Upstream unavailable'
}

export const fetchWithRetry = async (
  input: string,
  init: RequestInit,
  timeoutMs: number,
  retries: number,
): Promise<Response> => {
  let attempt = 0
  let lastError: unknown

  while (attempt <= retries) {
    const controller = new AbortController()
    const timer = setTimeout(() => {
      controller.abort()
    }, timeoutMs)

    try {
      const response = await fetch(input, {
        ...init,
        signal: controller.signal,
      })
      clearTimeout(timer)

      if (!response.ok) {
        throw new HttpError(
          502,
          'UPSTREAM_ERROR',
          `Sony upstream returned ${String(response.status)}`,
        )
      }

      return response
    } catch (error) {
      clearTimeout(timer)
      lastError = error
      attempt += 1
    }
  }

  throw new HttpError(502, 'UPSTREAM_UNAVAILABLE', describeError(lastError))
}
