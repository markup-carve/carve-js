import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import cases from './fixtures/comment-line-below-span-column-keeps-the-lazy-line.json'

// Expected HTML is the spec model's at carve e7897758 (carve#5486, carve#5021).
describe('a comment line below a nested span column is payload, and the line after the span folds', () => {
  for (const { source, html } of cases) {
    it(JSON.stringify(source), () => {
      expect(carveToHtml(source).replace(/>\s+</g, '><').trim()).toBe(html)
    })
  }
})
