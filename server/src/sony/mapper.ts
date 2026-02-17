import type { Game } from '@psstore/shared'
import type { Product } from './types.js'

const DEFAULT_DISCOUNT_DATE = '1975-01-01T00:00:00Z'

const toIsoOrDefault = (value?: string): string => {
  if (!value) {
    return DEFAULT_DISCOUNT_DATE
  }

  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : DEFAULT_DISCOUNT_DATE
}

export const productToGame = (product: Product): Game => {
  const releaseDate = toIsoOrDefault(product.releaseDate)
  const media = product.media ?? []
  const screenshots = media
    .filter((item) => item.type === 'IMAGE' && (item.role === 'SCREENSHOT' || item.role === 'MASTER'))
    .map((item) => item.url ?? '')
    .filter(Boolean)

  const basePrice = product.price?.basePrice ?? ''
  const discountedPrice = product.price?.discountedPrice ?? ''
  const hasDiscount = Boolean(product.price?.discountText)

  return {
    id: product.id ?? '',
    name: product.name ?? '',
    date: releaseDate,
    url: screenshots[0] ?? '',
    price: String(discountedPrice || basePrice || ''),
    discountDate: hasDiscount ? releaseDate : DEFAULT_DISCOUNT_DATE,
    screenshots,
    videos: [],
    genres: product.genres ?? [],
    description: '',
    studio: product.providerName ?? '',
    preOrder: Date.parse(releaseDate) > Date.now(),
  }
}

export const defaultDiscountDate = DEFAULT_DISCOUNT_DATE
