// The list views: NEW, UPCOMING, DISCOUNTED, MONTHLY, and BROWSE.
import { cardIds, expect, expectNoAxeViolations, test } from './support.js'
import { productId } from './servers.js'

test('the site opens on NEW with the newest game first', async ({ page }) => {
  await page.goto('/')

  await expect(page).toHaveURL(/\/new$/)
  const nav = page.getByRole('navigation', { name: 'Top navigation' })
  await expect(nav.getByRole('link', { name: 'New' })).toHaveAttribute(
    'aria-current',
    'page',
  )
  await expect(page.locator('a.game-card')).toHaveCount(4)
  // The test server sends NEW newest first: games 1 to 4 are 2, 4, 6, and 9
  // days old.
  expect(await cardIds(page)).toEqual([1, 2, 3, 4].map(productId))
  await expectNoAxeViolations(page)
})

test('UPCOMING shows a product and a concept card', async ({ page }) => {
  await page.goto('/new')
  await page.getByRole('link', { name: 'Upcoming', exact: true }).click()

  await expect(page).toHaveURL(/\/upcoming$/)
  const product = page.getByRole('link', { name: /Echo Harbor/ })
  await expect(product).toHaveAttribute('href', `/g/${productId(5)}`)
  // A concept has no product page: its card opens Sony's concept page and
  // shows no price.
  const concept = page.getByRole('link', {
    name: 'Frostline on PlayStation Store',
  })
  await expect(concept).toHaveAttribute(
    'href',
    'https://store.playstation.com/en-fi/concept/900000001',
  )
  await expect(concept.locator('.game-card--price')).toHaveText('Unknown')
  await expectNoAxeViolations(page)
})

test('DISCOUNTED shows the original, the sale, and the PS Plus price', async ({
  page,
}) => {
  await page.goto('/discounted')

  const card = page.locator(`a.game-card[data-game-id="${productId(8)}"]`)
  await expect(card).toContainText('Harbor Lights')
  const price = card.locator('.game-card--price')
  await expect(price.locator('s')).toHaveText('€59,99')
  await expect(price).toContainText('€29,99')
  await expect(price.locator('.game-card--plus')).toHaveText('PS+ Save 25%')
  await expectNoAxeViolations(page)
})

test('MONTHLY lists the PS Plus games without prices', async ({ page }) => {
  await page.goto('/monthly')

  await expect(page.locator('a.game-card')).toHaveCount(2)
  expect(await cardIds(page)).toEqual([10, 11].map(productId))
  await expect(page.locator('.game-card--price')).toHaveCount(0)
  await expectNoAxeViolations(page)
})

test('BROWSE loads one genre in one order across two pages', async ({
  page,
}) => {
  await page.goto('/browse')

  const form = page.getByRole('form', { name: 'Browse PS5 games' })
  await form.getByLabel('Genre').selectOption({ label: 'Action' })
  await form.getByLabel('Order').selectOption({ label: 'Name (Z–A)' })
  await expectNoAxeViolations(page)
  await form.getByRole('button', { name: 'Browse' }).click()

  await expect(page).toHaveURL(/genre=ACTION/)
  await expect(page).toHaveURL(/order=name-desc/)
  await expect(
    page.getByRole('heading', { name: 'Action · Name (Z–A)' }),
  ).toBeVisible()
  const cards = page.locator('a.game-card')
  await expect(cards.first()).toContainText('Action Sample 70')
  await expectNoAxeViolations(page)

  // The genre has 70 games and a page has 60, so scrolling to the end of
  // the grid loads the second page.
  const secondPage = page.waitForRequest(
    (request) =>
      request.url().includes('/api/games/browse') &&
      new URL(request.url()).searchParams.get('offset') === '60',
  )
  await page.locator('.games--sentinel').scrollIntoViewIfNeeded()
  await secondPage
  await expect(cards).toHaveCount(70)
  await expect(cards.last()).toContainText('Action Sample 01')
})

test('BROWSE shows the empty state of a genre without games', async ({
  page,
}) => {
  await page.goto('/browse?genre=PUZZLE&order=best-selling')

  await expect(page.getByRole('status')).toHaveText(
    'No PS5 games found in Puzzle',
  )
  await expectNoAxeViolations(page)
})
