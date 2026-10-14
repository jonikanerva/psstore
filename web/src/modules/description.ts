import DOMPurify from 'dompurify'

// The colour attributes that DOMPurify 3.4.16 keeps by default (its `html`,
// `svg`, and `mathMl` attribute allow-lists). Sony's colours can make the
// description text unreadable on the page background, for example
// `<font color="orange">` on white. Without these attributes, the text uses
// the page text colour (owner decision on #161).
// Not listed:
// - `style`: the Content-Security-Policy (`style-src 'self'`) blocks inline
//   style attributes and `<style>` elements; the game page journey tests it.
// - `text`, `link`, `alink`, `vlink`: DOMPurify drops them by default.
const COLOUR_ATTRIBUTES = [
  'color',
  'bgcolor',
  'background',
  'fill',
  'stroke',
  'stop-color',
  'flood-color',
  'lighting-color',
  'mathcolor',
  'mathbackground',
]

// XSS boundary: Sony's description HTML is untrusted. The result is the only
// value that the game page may inject as HTML.
export const sanitizeDescription = (html: string): string =>
  DOMPurify.sanitize(html, { FORBID_ATTR: COLOUR_ATTRIBUTES })
