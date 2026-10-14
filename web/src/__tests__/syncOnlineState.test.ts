import { onlineManager } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { syncOnlineState } from '../modules/syncOnlineState'

describe('syncOnlineState', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    onlineManager.setOnline(true)
  })

  it('marks the manager offline when the browser starts offline', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)

    syncOnlineState()

    expect(onlineManager.isOnline()).toBe(false)
  })

  it('keeps the manager online when the browser starts online', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)

    syncOnlineState()

    expect(onlineManager.isOnline()).toBe(true)
  })
})
