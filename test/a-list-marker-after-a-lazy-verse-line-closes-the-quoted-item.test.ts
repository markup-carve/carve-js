import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import cases from './fixtures/a-list-marker-after-a-lazy-verse-line-closes-the-quoted-item.json'

// Expected HTML is the spec model's at carve 55a7113d (markup-carve/carve#5037).
describe('a list marker after a lazy line in a quoted item\'s stanza closes the item and the quote', () => {
  for (const { source, html } of cases) {
    it(JSON.stringify(source), () => {
      expect(carveToHtml(source).replace(/>\s+</g, '><').trim()).toBe(html)
    })
  }
})
