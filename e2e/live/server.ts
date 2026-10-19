// Starts the release server of the live CSP check on a free port (#191), so
// two live checks on one machine do not collide.
//
// The server reads its port from `PORT` and uses its default port for 0, so
// this script asks the operating system for a free port first. It then
// starts the server with that port, waits until `/healthz` answers, and
// prints the address. `webServer.wait` of `playwright.live.config.ts` reads
// the port from that line. Another process can take the port between the
// check and the bind; the server then fails to start and the run stops.
//
// Usage: node e2e/live/server.ts <server binary>
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { setTimeout as sleep } from 'node:timers/promises'

const START_TIMEOUT_MS = 30_000
const POLL_INTERVAL_MS = 200

// A port that is free on all IPv4 interfaces, where the server binds.
const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '0.0.0.0', () => {
      const address = probe.address()
      const port =
        typeof address === 'object' && address !== null ? address.port : 0
      probe.close(() => {
        resolve(port)
      })
    })
  })

const isHealthy = async (origin: string): Promise<boolean> => {
  try {
    const answer = await fetch(`${origin}/healthz`)
    return answer.ok
  } catch {
    return false
  }
}

const binary = process.argv[2]
if (binary === undefined) {
  process.stderr.write('usage: node e2e/live/server.ts <server binary>\n')
  process.exit(2)
}

const port = await freePort()
const origin = `http://127.0.0.1:${String(port)}`
const server = spawn(binary, [], {
  stdio: 'inherit',
  env: { ...process.env, PORT: String(port) },
})

// A stop by the forwarded signal is a clean end; any other signal is not.
server.once('exit', (code, signal) => {
  process.exit(code ?? (signal === 'SIGTERM' || signal === 'SIGINT' ? 0 : 1))
})
const running = (): boolean =>
  server.exitCode === null && server.signalCode === null
// Playwright stops the web server with SIGTERM; the server then drains.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    server.kill(signal)
  })
}

const deadline = Date.now() + START_TIMEOUT_MS
let healthy = false
while (running() && !healthy && Date.now() <= deadline) {
  healthy = await isHealthy(origin)
  if (!healthy) {
    await sleep(POLL_INTERVAL_MS)
  }
}
if (healthy) {
  process.stdout.write(`live server listening on ${origin}\n`)
} else if (running()) {
  process.stderr.write('the live server did not answer /healthz\n')
  server.kill('SIGTERM')
}
