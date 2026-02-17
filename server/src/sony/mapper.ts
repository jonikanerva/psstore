import type { Game } from '@psstore/shared'
import type { Concept } from './types.js'

const DEFAULT_DISCOUNT_DATE = ''
const DEFAULT_RELEASE_DATE = ''

const toIsoOrDefault = (value?: string): string => {
  if (!value) {
    return DEFAULT_RELEASE_DATE
  }

  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : DEFAULT_RELEASE_DATE
}

const COVER_ROLE_PRIORITY = [
  'MASTER',
  'GAMEHUB_COVER_ART',
  'PORTRAIT_BANNER',
  'FOUR_BY_THREE_BANNER',
  'SIXTEEN_BY_NINE_BANNER',
  'SCREENSHOT',
]

const imageMedia = (concept: Concept) =>
  (concept.media ?? [])
    .filter((item) => item.type === 'IMAGE' && Boolean(item.url))
    .map((item) => ({ role: item.role ?? '', url: item.url ?? '' }))

const conceptScreenshots = (concept: Concept): string[] =>
  imageMedia(concept)
    .filter((item) => item.role === 'SCREENSHOT')
    .map((item) => item.url)

const conceptCover = (concept: Concept): string => {
  const images = imageMedia(concept)

  for (const role of COVER_ROLE_PRIORITY) {
    const match = images.find((image) => image.role === role)
    if (match?.url) {
      return match.url
    }
  }

  return images[0]?.url ?? ''
}

const conceptVideos = (concept: Concept): string[] =>
  (concept.media ?? [])
    .filter((item) => item.type === 'VIDEO' && Boolean(item.url))
    .map((item) => item.url ?? '')
    .filter(Boolean)

const serviceBranding = (concept: Concept): string[] => [
  ...(concept.price?.serviceBranding ?? []),
  ...(concept.price?.upsellServiceBranding ?? []),
]

export const isConceptDiscounted = (concept: Concept): boolean => {
  const base = concept.price?.basePrice ?? ''
  const discounted = concept.price?.discountedPrice ?? ''
  const hasDiscountText = Boolean(concept.price?.discountText)
  return hasDiscountText || (Boolean(base) && Boolean(discounted) && base !== discounted)
}

export const isConceptPlus = (concept: Concept): boolean =>
  serviceBranding(concept).some((value) => value.toUpperCase() === 'PS_PLUS')

const conceptId = (concept: Concept): string => concept.products?.[0]?.id ?? concept.id ?? ''

export const conceptToGame = (concept: Concept): Game => {
  const screenshots = conceptScreenshots(concept)
  const cover = conceptCover(concept)
  const videos = conceptVideos(concept)
  const releaseDate = toIsoOrDefault(concept.products?.[0]?.releaseDate)
  const discounted = isConceptDiscounted(concept)
  const hasReleaseDate = Boolean(releaseDate)

  return {
    id: conceptId(concept),
    name: concept.name ?? '',
    date: releaseDate,
    url: cover,
    price: String(concept.price?.discountedPrice || concept.price?.basePrice || ''),
    discountDate: discounted && hasReleaseDate ? releaseDate : DEFAULT_DISCOUNT_DATE,
    screenshots,
    videos,
    genres: concept.products?.[0]?.genres ?? [],
    description: '',
    studio: concept.products?.[0]?.providerName ?? '',
    preOrder: hasReleaseDate && Date.parse(releaseDate) > Date.now(),
  }
}

export const defaultDiscountDate = DEFAULT_DISCOUNT_DATE
