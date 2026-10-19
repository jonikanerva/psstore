// The live CSP check: the release server against live Sony, with the real
// images and videos. The shared fixture fails the test on any
// `securitypolicyviolation` event, CSP console error, or page error. The
// test prints its counts as evidence for the PR.
import type { Page } from '@playwright/test'
import { expect, test } from '../tests/support.js'

// The origin of the live server. `live/server.ts` prints it, and
// `webServer.wait` stores its port (#191). The test reads it in the worker,
// because the runner loads the configuration before the server prints its
// port.
const liveServerUrl = (): string => {
  const port = process.env['PSSTORE_LIVE_PORT']
  if (port === undefined || !/^[0-9]+$/.test(port)) {
    throw new Error(
      'PSSTORE_LIVE_PORT is not set: run the check with playwright.live.config.ts',
    )
  }
  return `http://127.0.0.1:${port}`
}

test.use({ routeSonyMedia: false })

interface ListedGame {
  readonly id: string
  readonly videos: number
  readonly screenshots: number
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const countOf = (value: unknown): number =>
  Array.isArray(value) ? value.length : 0

// The games of a list answer, reduced to what the check needs.
const listedGames = (body: unknown): ListedGame[] => {
  const games = isRecord(body) ? body['games'] : undefined
  if (!Array.isArray(games)) {
    return []
  }
  return games.flatMap((game: unknown) =>
    isRecord(game) && typeof game['id'] === 'string'
      ? [
          {
            id: game['id'],
            videos: countOf(game['videos']),
            screenshots: countOf(game['screenshots']),
          },
        ]
      : [],
  )
}

// The number of images on the page that loaded.
const loadedImages = (page: Page): Promise<number> =>
  page
    .locator('img')
    .evaluateAll(
      (images) =>
        images.filter(
          (image) =>
            image instanceof HTMLImageElement && image.naturalWidth > 0,
        ).length,
    )

// Scrolls through the grid, so that the lazy images load.
const scrollThroughGrid = async (page: Page): Promise<void> => {
  const cards = page.locator('a.game-card')
  const total = await cards.count()
  for (let index = 0; index < total; index += 6) {
    await cards.nth(index).scrollIntoViewIfNeeded()
  }
}

test('live pages cause no CSP violation', async ({ page, externalOrigins }) => {
  const counts: Record<string, number | string> = {}
  const origin = liveServerUrl()

  // NEW, with the covers of every loaded card.
  await page.goto(`${origin}/new`)
  const cards = page.locator('a.game-card')
  await expect(cards.first()).toBeVisible()
  await scrollThroughGrid(page)
  counts['newCards'] = await cards.count()
  counts['newImagesLoaded'] = await loadedImages(page)

  // The other anonymous lists. MONTHLY reads the PS Plus feed, a source of
  // its own, so its images can come from another host (#162).
  for (const view of ['upcoming', 'discounted', 'monthly'] as const) {
    await page.goto(`${origin}/${view}`)
    await expect(cards.first()).toBeVisible()
    await scrollThroughGrid(page)
    counts[`${view}Cards`] = await cards.count()
    counts[`${view}ImagesLoaded`] = await loadedImages(page)
  }

  // A game page with screenshots and a video. The NEW list carries the
  // media of each game.
  const answer = await page.request.get(
    `${origin}/api/games/new?offset=0&size=60`,
  )
  const body: unknown = await answer.json()
  const withMedia = listedGames(body).find(
    (game) => game.videos > 0 && game.screenshots > 0,
  )
  expect(withMedia, 'a NEW game with screenshots and a video').toBeDefined()
  if (withMedia === undefined) {
    return
  }
  counts['gamePage'] = withMedia.id
  await page.goto(`${origin}/g/${encodeURIComponent(withMedia.id)}`)
  const media = page.getByRole('region', { name: 'Media' })
  await expect(media).toBeVisible()
  const items = media.getByRole('button')
  counts['mediaItems'] = await items.count()
  await items.last().click()
  const video = page.locator('dialog video')
  await expect(video).toBeVisible()
  await expect
    .poll(() =>
      video.evaluate((element) =>
        element instanceof HTMLVideoElement ? element.readyState : 0,
      ),
    )
    .toBeGreaterThan(0)
  await page.keyboard.press('Escape')
  counts['gamePageImagesLoaded'] = await loadedImages(page)

  // BROWSE: the first genre in the default Sony order.
  await page.goto(`${origin}/browse`)
  const genre = page.getByLabel('Genre')
  await expect(genre.locator('option')).not.toHaveCount(1)
  await genre.selectOption({ index: 1 })
  await page.getByLabel('Order').selectOption('best-selling')
  await page.getByRole('button', { name: 'Browse' }).click()
  await expect(cards.first()).toBeVisible()
  await scrollThroughGrid(page)
  counts['browseCards'] = await cards.count()
  counts['browseImagesLoaded'] = await loadedImages(page)

  // Search all PS5 games.
  const field = page.getByRole('searchbox', { name: 'Search' })
  await field.fill('lego')
  await field.press('Enter')
  await expect(page.getByRole('heading', { name: /Results for/ })).toBeVisible()
  await scrollThroughGrid(page)
  counts['searchCards'] = await cards.count()
  counts['searchImagesLoaded'] = await loadedImages(page)

  counts['externalOrigins'] = [...externalOrigins].sort().join(' ')
  test.info().annotations.push({
    type: 'live counts',
    description: JSON.stringify(counts),
  })
  process.stdout.write(`live CSP counts: ${JSON.stringify(counts)}\n`)
})
