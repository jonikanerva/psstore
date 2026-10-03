import { Duration, Effect, Layer, Redacted } from 'effect'
import { HttpEffect, HttpServerResponse } from 'effect/http'
import { HttpApiBuilder } from 'effect/http-api'
import {
  NPSSO_COOKIE_MAX_AGE_SECONDS,
  NPSSO_COOKIE_NAME,
  NPSSO_COOKIE_PATH,
} from '../config/env.js'
import { SessionRejected } from '../errors/errors.js'
import { AccountService } from '../services/accountService.js'
import { GamesService } from '../services/gamesService.js'
import { CurrentNpsso, gamesApi, NpssoAuth, npssoSecurity } from './gamesApi.js'

// Thin handlers: take decoded input, call the service, return its Effect.
// The typed error channel is mapped to HTTP status by the endpoint definitions
// in gamesApi.ts. One of the three modules permitted to import `effect/http-api`.

// Attributes shared by the cookie when it is set and when it is cleared; a
// browser clears a cookie only when the attributes match.
const npssoCookieOptions = {
  path: NPSSO_COOKIE_PATH,
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
} as const

const expireNpssoCookie = HttpEffect.appendPreResponseHandler(
  (_request, response) =>
    Effect.orDie(
      HttpServerResponse.expireCookie(
        response,
        NPSSO_COOKIE_NAME,
        npssoCookieOptions,
      ),
    ),
)

export const gamesGroupLive = HttpApiBuilder.group(
  gamesApi,
  'games',
  (handlers) =>
    Effect.gen(function* () {
      const games = yield* GamesService
      const account = yield* AccountService
      return handlers.handleAll({
        new: ({ query }) => games.getNewGames(query.offset, query.size),
        upcoming: ({ query }) =>
          games.getUpcomingGames(query.offset, query.size),
        discounted: ({ query }) =>
          games.getDiscountedGames(query.offset, query.size),
        monthly: ({ query }) => games.getMonthlyGames(query.offset, query.size),
        purchased: () =>
          Effect.gen(function* () {
            const npsso = yield* CurrentNpsso
            return yield* account.getPurchasedGames(npsso)
          }),
        wishlist: () =>
          Effect.gen(function* () {
            const npsso = yield* CurrentNpsso
            return yield* account.getWishlistGames(npsso)
          }),
        search: ({ query }) =>
          games.searchGames(query.q, query.offset, query.size),
        getById: ({ params }) => games.getGameById(params.id),
      })
    }),
)

export const sessionGroupLive = HttpApiBuilder.group(
  gamesApi,
  'session',
  (handlers) =>
    Effect.gen(function* () {
      const account = yield* AccountService
      return handlers
        .handle('signIn', ({ payload }) =>
          account.verifyNpsso(payload.npsso).pipe(
            // The cookie is set only after Sony accepted the NPSSO.
            Effect.andThen(
              HttpApiBuilder.securitySetCookie(npssoSecurity, payload.npsso, {
                ...npssoCookieOptions,
                maxAge: Duration.seconds(NPSSO_COOKIE_MAX_AGE_SECONDS),
              }),
            ),
          ),
        )
        .handle('signOut', () => expireNpssoCookie)
    }),
)

// Reads the NPSSO from the cookie scheme. An empty value (no cookie) is a 401
// before any Sony call. A 401 response, from here or from the handler, also
// clears the cookie: only a definitive Sony rejection maps to 401.
export const NpssoAuthLive = Layer.succeed(
  NpssoAuth,
  NpssoAuth.of({
    npsso: (httpEffect, { credential }) =>
      // Redacted.value: emptiness check only, the value is never read further.
      Redacted.value(credential) === ''
        ? Effect.fail(new SessionRejected({ message: 'Not signed in' }))
        : HttpEffect.appendPreResponseHandler((_request, response) =>
            response.status === 401
              ? Effect.orDie(
                  HttpServerResponse.expireCookie(
                    response,
                    NPSSO_COOKIE_NAME,
                    npssoCookieOptions,
                  ),
                )
              : Effect.succeed(response),
          ).pipe(
            Effect.andThen(
              Effect.provideService(httpEffect, CurrentNpsso, credential),
            ),
          ),
  }),
)
