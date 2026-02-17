import { runCapture } from './capture/capture.js'
import { runDiff } from './commands/diff.js'
import { runNormalize } from './commands/normalize.js'
import { runRefresh } from './commands/refresh.js'
import { runValidate } from './commands/validate.js'

export const usageText = [
  'Usage: npm run sony -- <command> [flags]',
  'Commands:',
  '  capture',
  '  normalize [--write-manifest]',
  '  validate [--candidate]',
  '  diff [--ci]',
  '  refresh',
].join('\n')

const main = async (): Promise<void> => {
  const [command, ...rest] = process.argv.slice(2)
  const args = new Set(rest)

  switch (command) {
    case 'capture': {
      const count = await runCapture()
      console.info(`Captured ${count} GraphQL requests.`)
      return
    }
    case 'normalize':
      await runNormalize(args.has('--write-manifest'))
      console.info('Normalization complete.')
      return
    case 'validate':
      await runValidate(args.has('--candidate'))
      console.info('Validation passed.')
      return
    case 'diff':
      await runDiff(args.has('--ci'))
      console.info('Diff complete.')
      return
    case 'refresh':
      await runRefresh()
      console.info('Refresh complete.')
      return
    default:
      console.info(usageText)
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exitCode = 1
})
