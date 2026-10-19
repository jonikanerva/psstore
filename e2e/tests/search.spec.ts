// The search field: the name filter of the open list and the search of all
// PS5 games.
import {
  cardIds,
  expect,
  expectNoAxeViolations,
  resultsStatus,
  test,
} from './journey.js'
import { productId } from './servers.js'

test('the search field filters the open list by name', async ({ page }) => {
  await page.goto('/new')
  await expect(page.locator('a.game-card')).toHaveCount(4)

  await page.getByRole('searchbox', { name: 'Search' }).fill('basalt')

  expect(await cardIds(page)).toEqual([productId(2)])
  await expect(
    page.getByRole('link', {
      name: 'Press Enter to search all PS5 games for "basalt"',
    }),
  ).toBeVisible()
  await expectNoAxeViolations(page)
})

test('Enter searches all PS5 games for the term', async ({ page }) => {
  await page.goto('/new')
  const field = page.getByRole('searchbox', { name: 'Search' })

  // No NEW game matches, so only the search-all card is left.
  await field.fill('harbor')
  await expect(page.locator('a.game-card')).toHaveCount(0)
  await field.press('Enter')

  await expect(page).toHaveURL(/\/search\?q=harbor$/)
  await expect(
    page.getByRole('heading', { name: 'Results for "harbor"' }),
  ).toBeVisible()
  await expect(resultsStatus(page)).toHaveText('2 PS5 games found')
  // The search sorts by date, newest first: UPCOMING Echo Harbor, then the
  // discounted Harbor Lights.
  expect(await cardIds(page)).toEqual([productId(5), productId(8)])
  await expectNoAxeViolations(page)
})

test('a search without a match shows the empty state', async ({ page }) => {
  await page.goto('/search?q=zzzz')

  await expect(resultsStatus(page)).toHaveText('No PS5 games found for "zzzz"')
  await expectNoAxeViolations(page)
})
