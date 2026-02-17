import fs from 'node:fs/promises'
import { chromium } from 'playwright'
import type { CaptureRecord, ContractFeature } from '../contract/types.js'
import { ensureDir } from '../io/files.js'
import { paths } from '../io/paths.js'
import { coreFeatureRoutes } from './features.js'

interface CaptureEntry extends CaptureRecord {
  feature: ContractFeature
}

const graphqlRequest = (url: string): boolean => /graphql|\/api\/graphql|\/graphql\/v1\/op/i.test(url)

export const runCapture = async (): Promise<number> => {
  await ensureDir(paths.rawCapture)
  await fs.writeFile(paths.rawCapture, '', 'utf8')

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext()
  const page = await context.newPage()

  let captured = 0
  let currentFeature: ContractFeature = 'new'

  page.on('response', async (response) => {
    const request = response.request()
    const url = request.url()

    if (!graphqlRequest(url)) {
      return
    }

    let responseJson: unknown = {}
    try {
      responseJson = await response.json()
    } catch {
      responseJson = {}
    }

    const entry: CaptureEntry = {
      feature: currentFeature,
      method: request.method(),
      url,
      headers: request.headers(),
      status: response.status(),
      responseJson,
    }

    await fs.appendFile(paths.rawCapture, `${JSON.stringify(entry)}\n`, 'utf8')
    captured += 1
  })

  for (const route of coreFeatureRoutes) {
    currentFeature = route.feature

    try {
      await page.goto(route.url, {
        waitUntil: 'domcontentloaded',
        timeout: 45000,
      })
      await page.waitForTimeout(2500)
    } catch {
      // Continue to next route even if one storefront URL fails.
    }
  }

  await context.close()
  await browser.close()

  return captured
}
