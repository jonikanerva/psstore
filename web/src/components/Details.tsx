import {
  useNavigate,
  useParams,
  useRouter,
  useRouterState,
} from '@tanstack/react-router'
import { useEffect } from 'react'
import { readPdpOrigin } from '../modules/pdpOrigin'
import GameDetailsPage from './GameDetailsPage'

const TEXT_ENTRY_TAGS = ['INPUT', 'TEXTAREA', 'SELECT']

const isTextEntry = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (TEXT_ENTRY_TAGS.includes(target.tagName) || target.isContentEditable)

const isPlainEscape = (event: KeyboardEvent): boolean =>
  event.key === 'Escape' &&
  !event.defaultPrevented &&
  !event.repeat &&
  !event.altKey &&
  !event.ctrlKey &&
  !event.metaKey &&
  !event.shiftKey

const Details = () => {
  const { gameId } = useParams({ from: '/g/$gameId' })
  const router = useRouter()
  const navigate = useNavigate()
  const origin = useRouterState({
    select: (state) => readPdpOrigin(state.location.state),
  })

  // Back restores the list with its scroll offset. Without a history entry to
  // return to, a tab origin is opened afresh; a search origin has lost its
  // term, so it falls back to NEW.
  const close = () => {
    if (origin !== undefined && router.history.canGoBack()) {
      router.history.back()
      return
    }
    void navigate({
      to: origin === undefined || origin === '/search' ? '/new' : origin,
      replace: true,
    })
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        !isPlainEscape(event) ||
        isTextEntry(event.target) ||
        document.querySelector('dialog[open]') !== null
      ) {
        return
      }
      close()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
    }
  })

  return (
    <div className="details-frame">
      <div className="details-frame--bar">
        <button
          type="button"
          className="details-frame--close"
          aria-label="Close game page"
          onClick={close}
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
      <GameDetailsPage gameId={gameId} />
    </div>
  )
}

export default Details
