import { QueryClient } from '@tanstack/react-query'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { RouterProvider } from '@tanstack/react-router'
import { createRoot } from 'react-dom/client'
import { router } from './router'
import './index.css'

// Sony response payloads are cached client-side for render performance and
// persisted with an explicit short TTL (VISION persistence posture). gcTime
// bounds how long an idle entry survives in storage.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      gcTime: 1000 * 60 * 30,
      retry: 1,
    },
  },
})

// Synchronous localStorage persister, as mandated by STACK.md §2 (the official
// persister for the TanStack Query client cache). The async variant the lint
// rule suggests is unnecessary for synchronous localStorage.
// eslint-disable-next-line @typescript-eslint/no-deprecated -- STACK.md §2 specifies createSyncStoragePersister for localStorage
const persister = createSyncStoragePersister({ storage: window.localStorage })

const container = document.getElementById('root')
if (container) {
  createRoot(container).render(
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister,
        maxAge: 1000 * 60 * 30,
        dehydrateOptions: {
          // Persist ONLY Sony payload caches (games lists + game detail). Nothing
          // else ever enters the query cache, but the explicit allow-list keeps
          // the guarantee structural: no search / view / sort / scroll / behaviour
          // state is ever written to localStorage (VISION privacy posture,
          // ux condition 1, da #4).
          shouldDehydrateQuery: (query) => {
            const key = query.queryKey[0]
            return key === 'games' || key === 'game'
          },
        },
      }}
    >
      <RouterProvider router={router} />
    </PersistQueryClientProvider>,
  )
}
