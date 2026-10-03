const NAMED: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

const isCodePoint = (value: number): boolean =>
  Number.isInteger(value) &&
  value > 0 &&
  value <= 0x10ffff &&
  !(value >= 0xd800 && value <= 0xdfff)

/**
 * Decode HTML character entities in one pass: `&amp; &lt; &gt; &quot; &apos;`
 * and numeric `&#NN;` / `&#xHH;`. Decoded text is not scanned again, so
 * `&amp;amp;` becomes `&amp;`. An unknown entity or an invalid code point stays
 * as written.
 */
export const decodeHtmlEntities = (text: string): string =>
  text.replace(
    /&(?:#x([0-9a-f]+)|#(\d+)|([a-z]+));/gi,
    (
      match,
      hex: string | undefined,
      dec: string | undefined,
      name: string | undefined,
    ) => {
      if (name !== undefined) {
        return NAMED[name.toLowerCase()] ?? match
      }
      const value =
        hex !== undefined
          ? Number.parseInt(hex, 16)
          : Number.parseInt(dec ?? '', 10)
      return isCodePoint(value) ? String.fromCodePoint(value) : match
    },
  )
