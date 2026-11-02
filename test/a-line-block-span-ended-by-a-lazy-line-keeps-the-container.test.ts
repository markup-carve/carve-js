import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import cases from './fixtures/a-line-block-span-ended-by-a-lazy-line-keeps-the-container.json'

// Expected HTML is the spec model's at carve cdf71041 (carve-js#4294, carve#4956).
describe('a lazy line that ends a %%% span in a line block leaves the block and its closer to the container', () => {
  for (const { source, html } of cases) {
    it(JSON.stringify(source), () => {
      expect(carveToHtml(source).replace(/>\s+</g, '><').trim()).toBe(html)
    })
  }
})
