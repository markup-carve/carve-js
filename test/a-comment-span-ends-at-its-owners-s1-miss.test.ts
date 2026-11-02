import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import cases from './fixtures/comment-span-ends-at-its-owners-s1-miss.json'

// Expected HTML is the spec model's at carve 1f958bac (carve-js#4276, carve#4956).
describe('a %%% span ends at the line that misses its owner and leaves the stanza as it was', () => {
  for (const { source, html } of cases) {
    it(JSON.stringify(source), () => {
      expect(carveToHtml(source).replace(/>\s+</g, '><').trim()).toBe(html)
    })
  }
})
