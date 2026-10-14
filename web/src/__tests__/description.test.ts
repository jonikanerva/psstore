import { describe, expect, it } from 'vitest'
import { sanitizeDescription } from '../modules/description'

// The description of `docs/contracts/api/game-detail-plus-price.json`: real
// Sony markup with an orange `<font>` (#161).
const SONY_DESCRIPTION =
  '<b><font color="orange">PRE-ORDER – IMMEDIATE PAYMENT REQUIRED</font></b><br><br/><br/>Game Content:<br/>- "Here Come the Grannies" bonus digital content<br/>'

// Parses sanitised HTML for structural checks.
const parse = (html: string): HTMLTemplateElement => {
  const template = document.createElement('template')
  template.innerHTML = html
  return template
}

// The names of every attribute in the sanitised HTML.
const attributeNames = (html: string): string[] =>
  [...parse(html).content.querySelectorAll('*')].flatMap((element) =>
    element.getAttributeNames(),
  )

describe('sanitizeDescription', () => {
  it('drops the colour of the Sony description and keeps its text and formatting', () => {
    const html = sanitizeDescription(SONY_DESCRIPTION)
    const content = parse(html).content

    expect(attributeNames(html)).toEqual([])
    expect(content.querySelector('b > font')?.textContent).toBe(
      'PRE-ORDER – IMMEDIATE PAYMENT REQUIRED',
    )
    expect(content.querySelectorAll('br')).toHaveLength(5)
    expect(content.textContent).toContain(
      '- "Here Come the Grannies" bonus digital content',
    )
  })

  it.each([
    ['font color', '<font color="#ff8800">Text</font>'],
    ['table bgcolor', '<table bgcolor="black"><tr><td>Text</td></tr></table>'],
    ['cell bgcolor', '<table><tr><td bgcolor="#000000">Text</td></tr></table>'],
    ['row bgcolor', '<table><tr bgcolor="navy"><td>Text</td></tr></table>'],
    [
      'table background',
      '<table background="https://example.com/b.png"><tr><td>Text</td></tr></table>',
    ],
    ['hr color', '<hr color="yellow">'],
    ['marquee bgcolor', '<marquee bgcolor="red">Text</marquee>'],
    ['upper-case name', '<FONT COLOR="orange">Text</FONT>'],
    ['svg fill', '<svg><text fill="yellow">Text</text></svg>'],
    ['svg stroke', '<svg><text stroke="yellow">Text</text></svg>'],
    ['svg color', '<svg><g color="yellow"><text>Text</text></g></svg>'],
    [
      'svg stop-color',
      '<svg><linearGradient><stop stop-color="yellow"></stop></linearGradient></svg>',
    ],
    [
      'svg flood-color',
      '<svg><filter><feFlood flood-color="yellow"></feFlood></filter></svg>',
    ],
    [
      'svg lighting-color',
      '<svg><filter><feDiffuseLighting lighting-color="yellow"></feDiffuseLighting></filter></svg>',
    ],
    ['math mathcolor', '<math><mi mathcolor="yellow">x</mi></math>'],
    ['math mathbackground', '<math><mi mathbackground="black">x</mi></math>'],
  ])('drops the %s attribute', (_name, dirty) => {
    // Each sample has one attribute only, so no attribute may remain.
    expect(attributeNames(sanitizeDescription(dirty))).toEqual([])
  })

  it('keeps the formatting, the lists, and the links of a description', () => {
    const html = sanitizeDescription(
      '<p>Intro <b>bold</b> <i>italic</i> <strong>strong</strong> <em>em</em> <u>under</u></p><br><ul><li>One</li><li>Two</li></ul><ol><li>First</li></ol><a href="https://www.playstation.com/">PlayStation</a>',
    )
    const content = parse(html).content

    expect(
      [...content.querySelectorAll('*')].map((element) => element.localName),
    ).toEqual([
      'p',
      'b',
      'i',
      'strong',
      'em',
      'u',
      'br',
      'ul',
      'li',
      'li',
      'ol',
      'li',
      'a',
    ])
    expect(content.querySelector('a')?.getAttribute('href')).toBe(
      'https://www.playstation.com/',
    )
  })

  it('keeps the layout attributes that carry no colour', () => {
    const names = attributeNames(
      sanitizeDescription(
        '<font face="Arial" size="4" color="red">Text</font><p align="center">Centre</p>',
      ),
    )

    expect(names).toEqual(['face', 'size', 'align'])
  })

  it('still removes scripts and event handlers', () => {
    const html = sanitizeDescription(
      '<img src="x" onerror="alert(1)"><script>alert(2)</script><a href="javascript:alert(3)">Link</a>',
    )

    expect(html).not.toContain('onerror')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('javascript:')
  })
})
