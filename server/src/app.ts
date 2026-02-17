import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gamesRouter } from './api/gamesRoutes.js'
import { env } from './config/env.js'
import { errorMiddleware } from './errors/errorMiddleware.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const createApp = (): express.Express => {
  const app = express()

  app.use(express.json())

  app.use((request, response, next) => {
    const startedAt = Date.now()
    response.on('finish', () => {
      const duration = Date.now() - startedAt
      console.info(`${request.method} ${request.originalUrl} ${response.statusCode} ${duration}ms`)
    })
    next()
  })

  app.get('/healthz', (_request, response) => {
    response.json({ ok: true })
  })

  app.use('/api/games', gamesRouter)

  if (env.NODE_ENV === 'production') {
    const clientBuildPath = path.resolve(__dirname, '../../client/build')
    app.use(express.static(clientBuildPath))
    app.get('*', (_request, response) => {
      response.sendFile(path.join(clientBuildPath, 'index.html'))
    })
  }

  app.use(errorMiddleware)

  return app
}
