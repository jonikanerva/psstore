// The error states, against the test server whose store lookups all fail
// like an upstream outage.
import {
  expect,
  expectNoAxeViolations,
  resultsStatus,
  test,
} from './journey.js'
import { SYNTHETIC_NPSSO, productId } from './servers.js'

test.use({ testServer: 'outage' })

// NEW answers 502 (`upstream_unavailable`) and UPCOMING answers 503
// (`upstream_rate_limited`). The client retries once, then shows the error.
for (const [path, status] of [
  ['/new', 502],
  ['/upcoming', 503],
] as const) {
  test(`${path} shows the error state on an upstream ${String(status)}`, async ({
    page,
  }) => {
    const answers: number[] = []
    page.on('response', (response) => {
      if (response.url().includes('/api/games/')) {
        answers.push(response.status())
      }
    })
    await page.goto(path)

    await expect(page.getByText('Failed to load games')).toBeVisible()
    expect(answers).toContain(status)
    await expectNoAxeViolations(page)
  })
}

test('a failed search offers a retry', async ({ page }) => {
  await page.goto('/search?q=aurora')

  await expect(resultsStatus(page)).toHaveText('Search failed')
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible()
  await expectNoAxeViolations(page)
})

test('a failed genre list offers a retry', async ({ page }) => {
  await page.goto('/browse')

  await expect(resultsStatus(page)).toHaveText('Failed to load genres')
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible()
  await expectNoAxeViolations(page)
})

test('a failed game page lookup shows the error state', async ({ page }) => {
  await page.goto(`/g/${productId(1)}`)

  await expect(page.getByText('Game not found')).toBeVisible()
  await expectNoAxeViolations(page)
})

test('a sign-in during an outage shows the unavailable message', async ({
  page,
}) => {
  await page.goto('/wishlist')
  await page.getByLabel('NPSSO token').fill(SYNTHETIC_NPSSO)
  await page.getByRole('button', { name: 'Sign in' }).click()

  await expect(page.getByRole('alert')).toHaveText(
    'Sony sign-in is unavailable. Try again later.',
  )
  await expectNoAxeViolations(page)
})

test('a signed-in list that fails offers a retry', async ({
  page,
  context,
}) => {
  // The sign-in itself fails in an outage, so the test sets the cookie that
  // a successful sign-in sets.
  await context.addCookies([
    {
      name: 'npsso',
      value: SYNTHETIC_NPSSO,
      domain: '127.0.0.1',
      path: '/api',
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
    },
  ])
  await page.goto('/wishlist')

  await expect(page.getByText('Failed to load your wishlist')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible()
  await expectNoAxeViolations(page)
})
