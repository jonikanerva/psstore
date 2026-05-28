import type { Game } from '@psstore/shared'
import type { Concept } from './types.js'

const DEFAULT_DISCOUNT_DATE = ''
const DEFAULT_RELEASE_DATE = ''

// Module-level dedupe (per-process; resets on process restart).
// Drift warnings reference Sony product ids only — never names, prices, or
// localised strings (see AGENTS.md §8 / STACK.md §8).
const driftKeysSeen = new Set<string>()

export const __resetWarnOnceForTests = (): void => {
  driftKeysSeen.clear()
}

const warnOnceDrift = (signature: string, productId: string): void => {
  if (driftKeysSeen.has(signature)) return
  driftKeysSeen.add(signature)
  console.warn(
    JSON.stringify({
      source: 'mapper',
      kind: 'plus_upsell_drift',
      signature,
      productId,
    }),
  )
}

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
  const productId = conceptId(concept)

  // Sony's anonymous GraphQL exposes a `Concept.price.upsellText` string for
  // PS Plus members (e.g. "Säästä 10 %"). We surface the string verbatim —
  // no translation, no regex parsing, no euro derivation (decision #37).
  // An empty string is coerced to null here so the renderer never sees "".
  const plusUpsellText: string | null = ((): string | null => {
    const hasPlus = (concept.price?.upsellServiceBranding ?? []).some(
      (branding) => branding.toUpperCase() === 'PS_PLUS',
    )
    if (!hasPlus) return null
    const raw = concept.price?.upsellText
    if (typeof raw !== 'string' || raw === '') {
      warnOnceDrift('empty-upsell-text', productId)
      return null
    }
    return raw
  })()

  return {
    id: productId,
    name: concept.name ?? '',
    date: releaseDate,
    url: cover,
    price: concept.price?.discountedPrice || concept.price?.basePrice || '',
    originalPrice: discounted ? concept.price?.basePrice ?? '' : '',
    discountText: discounted ? concept.price?.discountText ?? '' : '',
    discountDate: discounted && hasReleaseDate ? releaseDate : DEFAULT_DISCOUNT_DATE,
    screenshots,
    videos,
    genres: concept.products?.[0]?.genres ?? [],
    description: '',
    studio: concept.products?.[0]?.providerName ?? '',
    preOrder: hasReleaseDate && Date.parse(releaseDate) > Date.now(),
    plusUpsellText,
  }
}

export const defaultDiscountDate = DEFAULT_DISCOUNT_DATE
