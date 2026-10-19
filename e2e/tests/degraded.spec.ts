// The degraded state (#164): the browser keeps a saved list, and the refresh
// of that list fails. The view keeps the list and shows one short note.
import { cardIds, expect, expectNoAxeViolations, test } from './journey.js'
import { productId, serverUrl } from './servers.js'

// The client marks a list stale after 5 minutes (`staleTime` in
// `web/src/main.tsx`). The fake clock moves past that time, so the reload
// refreshes the saved list.
const PAST_STALE_TIME = '06:00'

const NOTE = "Couldn't refresh. Showing the saved list."

test('NEW keeps the saved list and shows a note when the refresh fails', async ({
  page,
}) => {
  // The clock starts at the real time, so the release-day split sees the
  // same dates as the test server. The clock runs, so the retry delay of
  // the client still elapses.
  await page.clock.install({ time: Date.now() })
  await page.goto('/new')
  await expect(page.locator('a.game-card')).toHaveCount(4)
  // The persister writes the list to localStorage after a throttle delay.
  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.keys(window.localStorage).some((key) =>
          (window.localStorage.getItem(key) ?? '').includes('"new"'),
        ),
      ),
    )
    .toBe(true)

  // From now on, NEW gets the real answer of the outage server: a 502
  // Problem Details body.
  const failures: number[] = []
  await page.route('**/api/games/new**', async (route) => {
    const url = new URL(route.request().url())
    const response = await route.fetch({
      url: `${serverUrl('outage')}${url.pathname}${url.search}`,
    })
    failures.push(response.status())
    await route.fulfill({ response })
  })
  await page.clock.fastForward(PAST_STALE_TIME)
  await page.reload()

  await expect(page.getByRole('status')).toHaveText(NOTE)
  expect(await cardIds(page)).toEqual([1, 2, 3, 4].map(productId))
  await expect(page.getByText('Failed to load games')).toHaveCount(0)
  // The first attempt and the one retry of the client both failed.
  expect(failures).toEqual([502, 502])
  await expectNoAxeViolations(page)
})
