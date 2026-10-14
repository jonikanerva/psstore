// The main journey with the keyboard alone: the focus order, a visible focus
// indicator on each stop, and activation with Enter, Space, and Escape.
import type { Locator, Page } from '@playwright/test'
import { cardIds, expect, test } from './support.js'
import { productId } from './servers.js'

// `--focus-color` in `web/src/index.css`.
const FOCUS_COLOR = 'rgb(11, 116, 209)'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

// The focus indicator of the focused element: a solid outline of at least
// 2 px in the focus colour (STACK.md §11, WCAG 2.4.7).
const expectVisibleFocus = async (page: Page, what: string): Promise<void> => {
  const outline = await page.evaluate(() => {
    const element = document.activeElement
    if (element === null || element === document.body) {
      return null
    }
    const style = getComputedStyle(element)
    return {
      style: style.outlineStyle,
      wide: Number.parseFloat(style.outlineWidth) >= 2,
      color: style.outlineColor,
    }
  })
  expect(outline, `focus outline of ${what}`).toEqual({
    style: 'solid',
    wide: true,
    color: FOCUS_COLOR,
  })
}

const isFocused = (target: Locator): Promise<boolean> =>
  target.evaluate((element) => element === document.activeElement)

// Presses Tab until `target` has the focus.
const tabTo = async (page: Page, target: Locator): Promise<void> => {
  for (let step = 0; step < 30; step += 1) {
    await page.keyboard.press('Tab')
    if (await isFocused(target)) {
      return
    }
  }
  throw new Error('Tab never reached the target')
}

test('the main journey works with the keyboard alone', async ({ page }) => {
  await page.goto('/new')
  await expect(page.locator('a.game-card')).toHaveCount(4)

  // Tab visits every control in document order: the tabs, the search field,
  // the sort controls, and the game cards. Each stop shows its focus.
  const stops = await page.locator(FOCUSABLE).evaluateAll((elements) =>
    elements.map((element, index) => {
      element.setAttribute('data-e2e-stop', String(index))
      return String(index)
    }),
  )
  expect(stops).toHaveLength(16)
  for (const stop of stops) {
    await page.keyboard.press('Tab')
    const at = await page.evaluate(
      () => document.activeElement?.getAttribute('data-e2e-stop') ?? 'none',
    )
    expect(at, 'the focus order follows the document order').toBe(stop)
    await expectVisibleFocus(page, `stop ${stop}`)
  }

  // Shift+Tab goes back to the first card; Enter opens its game page.
  const firstCard = page.locator(`a.game-card[data-game-id="${productId(1)}"]`)
  for (let step = 0; step < 3; step += 1) {
    await page.keyboard.press('Shift+Tab')
  }
  await expect(firstCard).toBeFocused()
  await page.keyboard.press('Enter')
  const title = page.getByRole('heading', { level: 1, name: 'Aurora Drift' })
  await expect(title).toBeVisible()

  // Space activates the close button, and the focus returns to the card.
  await tabTo(page, page.getByRole('button', { name: 'Close game page' }))
  await expectVisibleFocus(page, 'the close button')
  await page.keyboard.press('Space')
  await expect(page).toHaveURL(/\/new$/)
  await expect(firstCard).toBeFocused()

  // Escape closes a game page too.
  await page.keyboard.press('Enter')
  await expect(title).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(/\/new$/)

  // Space on a sort control sorts the list by price, lowest first. A game
  // that a PS Plus tier includes ("Extra") sorts as 0 €.
  await tabTo(page, page.getByRole('button', { name: 'Sort by price' }))
  await page.keyboard.press('Space')
  await expect(
    page.getByRole('button', { name: 'Sort by price, ascending' }),
  ).toHaveAttribute('aria-pressed', 'true')
  expect(await cardIds(page)).toEqual([3, 4, 2, 1].map(productId))

  // The search field shows its focus, and Enter searches all PS5 games.
  await tabTo(page, page.getByRole('searchbox', { name: 'Search' }))
  await expectVisibleFocus(page, 'the search field')
  await page.keyboard.type('harbor')
  await page.keyboard.press('Enter')
  await expect(
    page.getByRole('heading', { name: 'Results for "harbor"' }),
  ).toBeVisible()
})

test('the BROWSE form works with the keyboard alone', async ({ page }) => {
  await page.goto('/browse')
  const genre = page.getByLabel('Genre')
  const order = page.getByLabel('Order')
  await expect(genre).toBeVisible()

  // Typing the first letters of an option selects it in a closed select.
  await tabTo(page, genre)
  await expectVisibleFocus(page, 'the genre select')
  await page.keyboard.type('Act')
  await expect(genre).toHaveValue('ACTION')
  await tabTo(page, order)
  await expectVisibleFocus(page, 'the order select')
  await page.keyboard.type('Name (Z')
  await expect(order).toHaveValue('name-desc')
  const browse = page.getByRole('button', { name: 'Browse' })
  await tabTo(page, browse)
  await expectVisibleFocus(page, 'the Browse button')
  await page.keyboard.press('Enter')

  await expect(page).toHaveURL(/genre=ACTION&order=name-desc/)
  await expect(page.locator('a.game-card').first()).toContainText(
    'Action Sample 70',
  )
})
