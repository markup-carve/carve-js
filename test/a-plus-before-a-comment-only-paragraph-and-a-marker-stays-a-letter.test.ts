import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import cases from './fixtures/a-plus-before-a-comment-only-paragraph-and-a-marker-stays-a-letter.json'

// Expected HTML is the spec model's at carve cdf71041 (carve-js#4295, carve#4799, carve#4890).
describe('a + looks past a paragraph of only braced comments that a marker ends, as past a %% line', () => {
  for (const { source, html } of cases) {
    it(JSON.stringify(source), () => {
      expect(carveToHtml(source).replace(/>\s+</g, '><').trim()).toBe(html)
    })
  }
})
