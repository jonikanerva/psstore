// The API client calls `fetch` with one `Request` object and no options. A
// test that stubs `fetch` reads the request through this view.
export interface SentRequest {
  readonly method: string
  // The path and the query, for example `/api/games/new?offset=0&size=60`.
  readonly url: string
  readonly cache: RequestCache
  readonly credentials: RequestCredentials
  readonly signal: AbortSignal
  // The body text. It reads a copy, so the stub can read it more than once.
  readonly body: () => Promise<string>
}

export const sentRequest = (
  input: RequestInfo | URL,
  init?: RequestInit,
): SentRequest => {
  // A new Request from a Request would take its body, so the API client's
  // own Request is read as it is.
  const request =
    input instanceof Request && init === undefined
      ? input
      : new Request(
          input instanceof Request
            ? input
            : new URL(String(input), location.origin),
          init,
        )
  const url = new URL(request.url)
  return {
    method: request.method,
    url: `${url.pathname}${url.search}`,
    cache: request.cache,
    credentials: request.credentials,
    signal: request.signal,
    body: () => request.clone().text(),
  }
}
