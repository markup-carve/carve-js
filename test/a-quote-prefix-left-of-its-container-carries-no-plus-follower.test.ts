import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import cases from './fixtures/a-quote-prefix-left-of-its-container-carries-no-plus-follower.json'

// Expected HTML is the spec model's at carve cdf71041 (carve-js#4296, carve#4396, carve#4409).
describe('a quote prefix left of the container holding that quote carries no + follower', () => {
  for (const { source, html } of cases) {
    it(JSON.stringify(source), () => {
      expect(carveToHtml(source).replace(/>\s+</g, '><').trim()).toBe(html)
    })
  }
})
