// The Content-Security-Policy allows images only from Sony's image host and
// videos only from Sony's video host (#162). Each case adds one element that
// the policy must block. The shared fixture records the violation and the
// console error of the browser; the test checks them and then clears them, so
// any other problem still fails the test.
import { expect, test } from './support.js'

interface BlockedCase {
  readonly name: string
  readonly tag: 'img' | 'video'
  readonly url: string
  readonly directive: 'img-src' | 'media-src'
}

const CASES: readonly BlockedCase[] = [
  {
    name: 'an image from another https host',
    tag: 'img',
    url: 'https://media.example.test/e2e/cover.png',
    directive: 'img-src',
  },
  {
    name: 'an image from the video host',
    tag: 'img',
    url: 'https://vulcan.dl.playstation.net/img/rnd/e2e/cover.png',
    directive: 'img-src',
  },
  {
    name: 'a video from another https host',
    tag: 'video',
    url: 'https://media.example.test/e2e/clip.mp4',
    directive: 'media-src',
  },
  {
    name: 'a video from the image host',
    tag: 'video',
    url: 'https://image.api.playstation.com/vulcan/ap/rnd/e2e/clip.mp4',
    directive: 'media-src',
  },
]

for (const blocked of CASES) {
  test(`the CSP blocks ${blocked.name}`, async ({ page, problems }) => {
    await page.goto('/new')
    await expect(page.locator('a.game-card').first()).toBeVisible()
    // The page itself caused no problem before the test element.
    expect(problems).toEqual([])

    await page.evaluate(({ tag, url }) => {
      const element = document.createElement(tag)
      element.setAttribute('src', url)
      document.body.append(element)
    }, blocked)

    const violation = `CSP violation: ${blocked.directive} blocked ${blocked.url}`
    await expect
      .poll(() => ({
        violation: problems.some((problem) => problem.startsWith(violation)),
        consoleError: problems.some(
          (problem) =>
            problem.startsWith('CSP console error:') &&
            problem.includes(blocked.url),
        ),
      }))
      .toEqual({ violation: true, consoleError: true })
    // Only the test element caused a problem.
    for (const problem of problems) {
      expect(problem).toContain(blocked.url)
    }
    problems.length = 0
  })
}
