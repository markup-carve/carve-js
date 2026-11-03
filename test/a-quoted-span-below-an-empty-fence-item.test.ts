import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import cases from './fixtures/quoted-span-below-an-empty-fence-item.json'

// Expected HTML is the spec model's at carve b426bf87 (carve-js#4276 item 1).
describe('a %%% span that closes every quoted host opens at the quote and ends at its S1 miss', () => {
  for (const { source, html } of cases) {
    it(JSON.stringify(source), () => {
      expect(carveToHtml(source).replace(/>\s+</g, '><').trim()).toBe(html)
    })
  }
})
