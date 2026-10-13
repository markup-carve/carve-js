import { expect, it } from 'vitest'
import { carveToHtml, parse, renderHtml, resolve } from '../src/index.js'
import fixtures from './fixtures/deep-term-comment-code-tails.json'

const normalized = (html: string) => html.replace(/>\s+</g, '><').trim()

for (const row of fixtures) {
  it(`keeps the definition term column after its comment: ${row.id}`, () => {
    expect(normalized(carveToHtml(row.source))).toBe(row.html)
    expect(normalized(renderHtml(resolve(parse(row.source))))).toBe(row.html)
    expect(normalized(renderHtml(resolve(parse(row.source, { positions: true }))))).toBe(row.html)
  })
}
