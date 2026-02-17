import { describe, expect, it } from 'vitest'
import { extractReleaseDateFromProductResponse, extractSearchGamesFromHtml } from '../sony/sonyClient.js'

describe('extractReleaseDateFromProductResponse', () => {
  it('extracts releaseDate from productRetrieve payload', () => {
    const result = extractReleaseDateFromProductResponse({
      data: {
        productRetrieve: {
          id: 'UP0102-PPSA02530_00-PRAGMATA00000000',
          releaseDate: '2026-04-23T21:00:00Z',
        },
      },
    })

    expect(result).toBe('2026-04-23T21:00:00Z')
  })
})

describe('extractSearchGamesFromHtml', () => {
  it('extracts search tiles from storefront html', () => {
    const html = `
      <ul>
        <li data-qa="search#productTile0" data-telemetry-meta="{&quot;id&quot;:&quot;P1&quot;,&quot;index&quot;:0,&quot;name&quot;:&quot;Destiny 2&quot;,&quot;price&quot;:&quot;€0.00&quot;}">
          <img data-qa="search#productTile0#game-art#image#preview" src="https://image.playstation.com/destiny2.jpg?x=1" />
        </li>
      </ul>
    `

    const games = extractSearchGamesFromHtml(html)
    expect(games).toHaveLength(1)
    expect(games[0]).toMatchObject({
      id: 'P1',
      name: 'Destiny 2',
      url: 'https://image.playstation.com/destiny2.jpg',
      price: '€0.00',
    })
  })
})
