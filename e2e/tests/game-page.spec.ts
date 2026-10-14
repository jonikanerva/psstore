// The game page: both prices, the critic score, the media, and the
// not-found state.
import { expect, expectNoAxeViolations, test } from './support.js'
import { MISSING_GAME_ID, productId } from './servers.js'

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
  await expect(page.getByRole('region', { name: 'Description' })).toContainText(
    'Aurora Drift is a synthetic game of the browser journeys.',
  )
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

test('an unknown game shows the not-found state', async ({ page }) => {
  await page.goto(`/g/${MISSING_GAME_ID}`)

  await expect(page.getByText('Game not found')).toBeVisible()
  await expectNoAxeViolations(page)
})
