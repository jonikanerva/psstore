import type { ContractFeature } from './types.js'

export const CORE_FEATURES: ContractFeature[] = [
  'new',
  'upcoming',
  'discounted',
  'details',
  'search',
]

// Features that capture cannot observe because they need a signed-in session.
// `sony:normalize` carries their canonical entries over unchanged;
// `sony:probe-purchased` is the only writer of their observed status.
export const SIGNED_IN_FEATURES: ContractFeature[] = ['purchased']

// The NARROW required-headers contract signal: the header(s) a normalized
// operation must record so the backend keeps sending them. This is the parser's
// emitted `required_headers` value — kept deliberately separate from the
// capture-time redaction safe-set below (the two concepts are independent: a
// contract signal vs a secrets filter; do not couple them).
export const REQUIRED_HEADERS = ['x-apollo-operation-name'] as const

// The WIDE capture-time redaction safe-set: the only header keys allowed to
// survive into the raw (gitignored) capture on local disk. Used ONLY by
// `redactHeaders`. Lowercased; membership is case-insensitive.
export const CAPTURE_HEADER_ALLOWLIST = [
  'x-apollo-operation-name',
  'content-type',
  'accept',
  'accept-language',
  'origin',
  'referer',
  'x-psn-store-locale',
] as const

// Any header key matching this is dropped first, before the allowlist is even
// consulted — defense-in-depth so a renamed/unexpected secret header can never
// slip through.
export const SENSITIVE_HEADER_PATTERN = /token|cookie|session|auth/i

const captureAllowlist = new Set<string>(CAPTURE_HEADER_ALLOWLIST)

/**
 * Redact request headers for the raw capture (defense-in-depth; the committed
 * manifest is already allowlist-filtered at parse time, so this hardens the
 * gitignored on-disk artifact, not a live leak).
 *
 * Deny-first: drop any key matching `SENSITIVE_HEADER_PATTERN`, THEN keep only
 * keys whose lowercased form is in `CAPTURE_HEADER_ALLOWLIST`. Case-insensitive,
 * pure (no I/O), returns a new object.
 */
export const redactHeaders = (
  headers: Record<string, string>,
): Record<string, string> => {
  const redacted: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (SENSITIVE_HEADER_PATTERN.test(key)) {
      continue
    }
    if (captureAllowlist.has(key.toLowerCase())) {
      redacted[key] = value
    }
  }
  return redacted
}
