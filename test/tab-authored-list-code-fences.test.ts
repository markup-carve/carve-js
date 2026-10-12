import { describe, expect, it } from 'vitest'
import { carveToHtml, parse, renderHtml } from '../src/index.js'
import cases from './fixtures/tab-authored-list-code-fences.json'

describe('tab-authored list code fences', () => {
  for (const fixture of cases) {
    it(fixture.id, () => {
      for (const html of [carveToHtml(fixture.source), renderHtml(parse(fixture.source))]) {
        expect(html.replace(/>\s+</g, '><').trim()).toBe(fixture.html)
      }
    })
  }
})
