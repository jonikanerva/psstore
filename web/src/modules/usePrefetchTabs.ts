import { useIsRestoring, useQueryClient } from '@tanstack/react-query'
import { useRouterState } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import {
  createPrefetchSession,
  runPrefetch,
  stopSignedInPrefetch,
} from './prefetchRunner'

// Warms the other tabs once per page load while the user reads the open one.
// Returns the function a sign-out calls before it resets the signed-in lists.
export const usePrefetchTabs = (): (() => void) => {
  const client = useQueryClient()
  const restoring = useIsRestoring()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const [session] = useState(createPrefetchSession)

  useEffect(() => {
    if (restoring) return
    const controller = new AbortController()
    void runPrefetch(client, session, pathname, controller.signal)
    return () => {
      controller.abort()
    }
  }, [client, session, restoring, pathname])

  useEffect(
    () => () => {
      session.pathname = undefined
    },
    [session],
  )

  return () => {
    stopSignedInPrefetch(session)
  }
}
