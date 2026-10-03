import { describe, expect, it } from 'vitest'
import { decodeHtmlEntities } from '../sony/htmlEntities.js'

describe('decodeHtmlEntities', () => {
  it('decodes the named entities', () => {
    expect(
      decodeHtmlEntities('a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos;'),
    ).toBe(`a & b <c> "d" 'e'`)
  })

  it('decodes decimal and hexadecimal numeric entities', () => {
    expect(decodeHtmlEntities('&#38; &#x26; &#8482; &#x2122; &#X2122;')).toBe(
      '& & ™ ™ ™',
    )
  })

  it('decodes only once', () => {
    expect(decodeHtmlEntities('&amp;amp;')).toBe('&amp;')
    expect(decodeHtmlEntities('&amp;#38;')).toBe('&#38;')
  })

  it('leaves unknown entities and invalid code points untouched', () => {
    expect(
      decodeHtmlEntities('&nbsp; &foo; &#0; &#xD800; &#1114112; &#;'),
    ).toBe('&nbsp; &foo; &#0; &#xD800; &#1114112; &#;')
  })

  it('leaves plain text, real symbols and bare ampersands as they are', () => {
    expect(decodeHtmlEntities('MLB® The Show™ 26 & more &')).toBe(
      'MLB® The Show™ 26 & more &',
    )
  })

  it('handles the empty string', () => {
    expect(decodeHtmlEntities('')).toBe('')
  })
})
