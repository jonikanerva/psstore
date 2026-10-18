// WISHLIST and PURCHASED: the sign-in form, the signed-in lists, and the
// sign-out. The test server accepts only the synthetic NPSSO.
import { cardIds, expect, expectNoAxeViolations, test } from './journey.js'
import { SYNTHETIC_NPSSO, productId } from './servers.js'

test('signed out, WISHLIST and PURCHASED show the sign-in form', async ({
  page,
}) => {
  for (const path of ['/wishlist', '/purchased']) {
    await page.goto(path)
    await expect(page.getByLabel('NPSSO token')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
    await expectNoAxeViolations(page)
  }
})

test('a rejected token shows the sign-in error', async ({ page }) => {
  await page.goto('/wishlist')
  await page.getByLabel('NPSSO token').fill('e2e-rejected-npsso-0000000000000')
  await page.getByRole('button', { name: 'Sign in' }).click()

  await expect(page.getByRole('alert')).toHaveText(
    'Sign-in failed. Check the token.',
  )
  await expect(page.getByLabel('NPSSO token')).toHaveValue('')
  await expectNoAxeViolations(page)
})

test('a sign-in shows both lists, and a sign-out shows the form again', async ({
  page,
  context,
}) => {
  await page.goto('/wishlist')
  await page.getByLabel('NPSSO token').fill(SYNTHETIC_NPSSO)
  await page.getByRole('button', { name: 'Sign in' }).click()

  // WISHLIST sorts by price, lowest first; the concept card has no price
  // and comes last.
  await expect(page.locator('.games--grid > a')).toHaveCount(3)
  expect(await cardIds(page)).toEqual([productId(8), productId(1), '900000002'])
  await expectNoAxeViolations(page)
  const cookies = await context.cookies()
  expect(cookies.map((cookie) => cookie.name)).toEqual(['npsso'])
  expect(cookies[0]?.httpOnly).toBe(true)

  await page.getByRole('link', { name: 'Purchased', exact: true }).click()
  await expect(page).toHaveURL(/\/purchased$/)
  // PURCHASED sorts by name.
  await expect(page.locator('a.game-card')).toHaveCount(3)
  expect(await cardIds(page)).toEqual([2, 3, 13].map(productId))
  await expectNoAxeViolations(page)

  // The public store has no page for this game, so the game page shows the
  // entry of the user's own list.
  await page.locator(`a.game-card[data-game-id="${productId(13)}"]`).click()
  await expect(
    page.getByRole('heading', { level: 1, name: 'Mosaic Engine' }),
  ).toBeVisible()
  await expect(page.getByRole('link', { name: 'Open In Store' })).toBeVisible()
  await expectNoAxeViolations(page)
  await page.getByRole('button', { name: 'Close game page' }).click()

  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByLabel('NPSSO token')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeHidden()
  expect(await context.cookies()).toEqual([])
})
