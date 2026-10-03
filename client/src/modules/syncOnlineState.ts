import { onlineManager } from '@tanstack/react-query'

// Call once before the first render: onlineManager assumes online until it
// receives an event, so a page opened offline would otherwise fetch and fail.
export const syncOnlineState = (): void => {
  onlineManager.setOnline(navigator.onLine)
}
