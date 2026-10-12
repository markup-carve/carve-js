import { describe, expect, it } from 'vitest'
import { carveToHtml, parse, renderHtml } from '../src/index.js'
import cases from './fixtures/tab-authored-list-code-fences.json'

describe('tab-authored list code fences', () => {
  for (const fixture of cases) {
    it(fixture.id, () => {
      for (const html of [carveToHtml(fixture.source), renderHtml(parse(fixture.source))]) {
        expect(html.replace(/>\s+</g, '><').replace(/&nbsp;/g, '\u00a0').trim()).toBe(fixture.html.replace(/&nbsp;/g, '\u00a0'))
        const payloads = [...html.matchAll(/<pre><code[^>]*>([\s\S]*?)<\/code><\/pre>/g)]
          .map((match) => match[1]!.replace(/&nbsp;/g, '\u00a0'))
        expect(payloads).toEqual(fixture.codePayloads.map((payload) => payload.replace(/&nbsp;/g, '\u00a0')))
      }
    })
  }
})
