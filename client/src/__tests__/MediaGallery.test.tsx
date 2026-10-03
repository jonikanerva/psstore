import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import MediaGallery from '../components/MediaGallery'

const renderGallery = () =>
  render(
    <MediaGallery
      name="Game"
      screenshots={['https://example.com/a.png', 'https://example.com/b.png']}
      videos={['https://example.com/v.mp4']}
    />,
  )

describe('MediaGallery', () => {
  // jsdom does not implement showModal.
  beforeAll(() => {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.setAttribute('open', '')
    }
  })

  afterEach(cleanup)

  it('opens the clicked item and wraps with the arrow keys', () => {
    renderGallery()

    fireEvent.click(screen.getByRole('button', { name: 'Open image 1 of 3' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog.querySelector('img')).toHaveAttribute(
      'src',
      'https://example.com/a.png',
    )

    fireEvent.keyDown(dialog, { key: 'ArrowLeft' })
    const video = dialog.querySelector('video')
    expect(video).toHaveAttribute('src', 'https://example.com/v.mp4')
    expect(video).not.toHaveAttribute('autoplay')

    fireEvent.keyDown(dialog, { key: 'ArrowRight' })
    expect(dialog.querySelector('img')).toHaveAttribute(
      'src',
      'https://example.com/a.png',
    )
  })

  it('closes with the close button', () => {
    renderGallery()

    fireEvent.click(screen.getByRole('button', { name: 'Open image 2 of 3' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
