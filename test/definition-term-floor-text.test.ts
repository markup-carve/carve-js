import { expect, it } from 'vitest'
import { carveToHtml, parse, renderHtml, resolve } from '../src/index.js'
import fixtures from './fixtures/definition-term-floor-text.json'

const normalized = (html: string) => html.replace(/>\s+</g, '><').trim()
for (const row of fixtures) {
  it(`keeps term ownership after floor text: ${row.id}`, () => {
    expect(normalized(carveToHtml(row.source))).toBe(row.html)
    expect(normalized(renderHtml(resolve(parse(row.source))))).toBe(row.html)
    expect(normalized(renderHtml(resolve(parse(row.source, { positions: true }))))).toBe(row.html)
  })
}
