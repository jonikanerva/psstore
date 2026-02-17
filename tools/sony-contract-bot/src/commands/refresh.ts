import { runCapture } from '../capture/capture.js'
import { runDiff } from './diff.js'
import { runNormalize } from './normalize.js'
import { runValidate } from './validate.js'

export const runRefresh = async (): Promise<void> => {
  const count = await runCapture()
  if (count === 0) {
    throw new Error('No GraphQL requests captured from fi-fi public storefront routes.')
  }

  await runNormalize(false)
  await runValidate(true)
  await runDiff(false)
}
