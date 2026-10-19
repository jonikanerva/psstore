// The game page: both prices, the critic score, the media, and the
// not-found state.
import type { Locator } from '@playwright/test'
import { expect, expectNoAxeViolations, test } from './journey.js'
import { MISSING_GAME_ID, productId } from './servers.js'

// The computed text colour of the first element of a locator.
const colourOf = (locator: Locator): Promise<string> =>
  locator.first().evaluate((element) => getComputedStyle(element).color)

test('a game card opens the game page with both prices and the score', async ({
  page,
}) => {
  await page.goto('/new')
  await page.locator(`a.game-card[data-game-id="${productId(1)}"]`).click()

  await expect(page).toHaveURL(new RegExp(`/g/${productId(1)}$`))
  await expect(
    page.getByRole('heading', { level: 1, name: 'Aurora Drift' }),
  ).toBeVisible()
  const prices = page.locator('.details-page--price')
  await expect(prices.filter({ hasText: 'Standard' })).toContainText('€69,99')
  await expect(prices.filter({ hasText: 'PS Plus' })).toContainText('€62,99')
  await expect(prices.filter({ hasText: 'IGDB score' })).toContainText('87')
  await expect(page.getByText('IGDB score 87 out of 100')).toBeAttached()
  await expect(
    page.getByRole('link', { name: 'Open In Store' }),
  ).toHaveAttribute(
    'href',
    `https://store.playstation.com/en-fi/product/${productId(1)}`,
  )
  const description = page.getByRole('region', { name: 'Description' })
  await expect(description).toContainText(
    'Aurora Drift is a synthetic game of the browser journeys.',
  )
  // Sony's orange notice uses the page text colour (#161). axe below also
  // checks its contrast.
  const notice = description.locator('font', {
    hasText: 'PRE-ORDER – IMMEDIATE PAYMENT REQUIRED',
  })
  await expect(notice).not.toHaveAttribute('color')
  expect(await colourOf(notice)).toBe(await colourOf(description))
  const media = page.getByRole('region', { name: 'Media' })
  await expect(media.getByRole('button')).toHaveCount(3)
  // The cover and the video come through the CSP from Sony's hosts.
  await expect
    .poll(() =>
      page
        .locator('.details-page--cover img')
        .evaluate((image) =>
          image instanceof HTMLImageElement ? image.naturalWidth : 0,
        ),
    )
    .toBeGreaterThan(0)
  await expectNoAxeViolations(page)

  await media.getByRole('button', { name: 'Open video 3 of 3' }).click()
  const dialog = page.getByRole('dialog', { name: 'Aurora Drift media' })
  await expect(dialog.locator('video')).toBeVisible()
  await expect
    .poll(() =>
      dialog
        .locator('video')
        .evaluate((video) =>
          video instanceof HTMLVideoElement ? video.readyState : 0,
        ),
    )
    .toBeGreaterThan(0)
  await expectNoAxeViolations(page)
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()

  await page.getByRole('button', { name: 'Close game page' }).click()
  await expect(page).toHaveURL(/\/new$/)
})

test('a game without a critic score shows no score box', async ({ page }) => {
  await page.goto(`/g/${productId(3)}`)

  await expect(
    page.getByRole('heading', { level: 1, name: 'Cinder Valley' }),
  ).toBeVisible()
  const prices = page.locator('.details-page--price')
  await expect(prices.filter({ hasText: 'Standard' })).toContainText('€39,99')
  await expect(prices.filter({ hasText: 'PS Plus' })).toContainText('Included')
  await expect(page.getByText('IGDB score')).toHaveCount(0)
  await expectNoAxeViolations(page)
})

// DOMPurify keeps a `style` attribute and a `<style>` element in Sony's
// description HTML. The Content-Security-Policy (`style-src 'self'`) must
// block both, so they cannot set a colour (#161). The probe is set with
// `innerHTML`, the same mechanism as the description.
test('the CSP blocks inline styles in the description', async ({
  page,
  problems,
}) => {
  await page.goto(`/g/${productId(3)}`)
  const description = page.getByRole('region', { name: 'Description' })
  await expect(description).toContainText(
    'Cinder Valley is a synthetic game of the browser journeys.',
  )

  await description.evaluate((region) => {
    const probe = document.createElement('div')
    probe.innerHTML =
      '<span class="inline-style-probe" style="color: rgb(255, 165, 0)">Inline style probe</span>' +
      '<style>.inline-style-probe { background-color: rgb(0, 0, 0) }</style>'
    region.append(probe)
  })
  const probe = page.locator('.inline-style-probe')
  await expect(probe).toBeVisible()

  // The directives of the reported violations. Chromium can report one
  // directive more than once.
  const blocked = (): string[] =>
    [
      ...new Set(
        problems
          .filter((problem) => problem.startsWith('CSP violation:'))
          .map((problem) => problem.split(' blocked ')[0] ?? problem),
      ),
    ].sort()
  await expect
    .poll(blocked)
    .toEqual(['CSP violation: style-src-attr', 'CSP violation: style-src-elem'])
  expect(await colourOf(probe)).toBe(await colourOf(description))
  expect(
    await probe.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    ),
  ).toBe('rgba(0, 0, 0, 0)')

  // The page reports its violations and console errors asynchronously.
  // Closing it ends the reports, so the filter below sees all of them. The
  // inline style reports are the expected result of this test; every other
  // browser problem still fails it.
  await page.close()
  const others = problems.filter((problem) => !problem.includes('style-src'))
  problems.splice(0, problems.length, ...others)
})

test('an unknown game shows the not-found state', async ({ page }) => {
  await page.goto(`/g/${MISSING_GAME_ID}`)

  await expect(page.getByText('Game not found')).toBeVisible()
  await expectNoAxeViolations(page)
})
