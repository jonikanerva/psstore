// The shared fixture of every journey.
//
// - The browser never reaches the network. A request to Sony's image or
//   video host gets a local file, so the browser applies the
//   Content-Security-Policy to the real host names. Any other request to a
//   host other than the test server is aborted and fails the test.
// - A `securitypolicyviolation` event, a console error about the
//   Content-Security-Policy, or an uncaught page error fails the test.
//
// The live CSP check (`live/`) sets `routeSonyMedia` to false: Sony's hosts
// then answer from the network, and the fixture lists every external host
// that the page contacted.
// The named export: the package types describe a CommonJS module, so its
// default export is not the class under NodeNext.
import { AxeBuilder } from '@axe-core/playwright'
import { test as base, expect, type Page } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export { expect }

const MEDIA = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../media',
)
const COVER = path.join(MEDIA, 'cover.png')
const CLIP = path.join(MEDIA, 'clip.mp4')

const IMAGE_ORIGIN = 'https://image.api.playstation.com'
const VIDEO_ORIGIN = 'https://vulcan.dl.playstation.net'

// The name of the binding that the page calls on a CSP violation.
const REPORT_BINDING = '__psstoreReportCspViolation'

// The fields of a `securitypolicyviolation` event that identify it.
interface Violation {
  readonly directive: string
  readonly blockedUri: string
  readonly sourceFile: string
}

interface GuardOptions {
  // True: Sony's image and video hosts answer from local files.
  readonly routeSonyMedia: boolean
}

interface GuardFixtures {
  // The problems of the test so far; the fixture fails the test on any.
  readonly problems: string[]
  // Every external origin that the page requested.
  readonly externalOrigins: Set<string>
}

const isLoopback = (url: URL): boolean =>
  url.hostname === '127.0.0.1' || url.hostname === 'localhost'

export const test = base.extend<GuardOptions & GuardFixtures>({
  routeSonyMedia: [true, { option: true }],

  problems: [
    async ({ context, routeSonyMedia }, use) => {
      const problems: string[] = []

      await context.exposeBinding(
        REPORT_BINDING,
        (_source, violation: Violation) => {
          problems.push(
            `CSP violation: ${violation.directive} blocked ${violation.blockedUri} (${violation.sourceFile})`,
          )
        },
      )
      // The listener runs before any page script, in every document.
      await context.addInitScript((binding: string) => {
        document.addEventListener(
          'securitypolicyviolation',
          (event) => {
            const report: unknown = Reflect.get(window, binding)
            if (typeof report === 'function') {
              void Reflect.apply(report, window, [
                {
                  directive: event.effectiveDirective,
                  blockedUri: event.blockedURI,
                  sourceFile: event.sourceFile,
                },
              ])
            }
          },
          { capture: true },
        )
      }, REPORT_BINDING)

      if (routeSonyMedia) {
        await context.route(
          (url) => !isLoopback(url),
          async (route) => {
            const url = new URL(route.request().url())
            if (url.origin === IMAGE_ORIGIN) {
              await route.fulfill({ path: COVER, contentType: 'image/png' })
            } else if (url.origin === VIDEO_ORIGIN) {
              await route.fulfill({ path: CLIP, contentType: 'video/mp4' })
            } else {
              problems.push(`unexpected request: ${url.origin}${url.pathname}`)
              await route.abort('blockedbyclient')
            }
          },
        )
      }

      context.on('console', (message) => {
        if (
          message.type() === 'error' &&
          /content security policy/i.test(message.text())
        ) {
          problems.push(`CSP console error: ${message.text()}`)
        }
      })
      context.on('weberror', (error) => {
        problems.push(`page error: ${error.error().message}`)
      })

      await use(problems)
      expect(problems, 'browser problems of the test').toEqual([])
    },
    { auto: true },
  ],

  externalOrigins: async ({ context }, use) => {
    const origins = new Set<string>()
    context.on('request', (request) => {
      const url = new URL(request.url())
      if (url.protocol.startsWith('http') && !isLoopback(url)) {
        origins.add(url.origin)
      }
    })
    await use(origins)
  },
})

// The WCAG 2.2 A and AA rules of axe. `wcag22aa` adds the target size rule.
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

// Fails on any axe violation of the page as it is now. Call it only after an
// assertion on the content of the state, never on a spinner.
export const expectNoAxeViolations = async (page: Page): Promise<void> => {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
  const violations = results.violations.map((violation) => ({
    rule: violation.id,
    impact: violation.impact,
    targets: violation.nodes.map((node) => node.target.join(' ')),
  }))
  expect(violations, `axe violations on ${page.url()}`).toEqual([])
}

// The ids of the game cards in screen order.
export const cardIds = (page: Page): Promise<string[]> =>
  page
    .locator('.games--grid a.game-card')
    .evaluateAll((cards) =>
      cards.map((card) =>
        card instanceof HTMLElement ? (card.dataset['gameId'] ?? '') : '',
      ),
    )
