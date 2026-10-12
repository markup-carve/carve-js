import { expect, it } from 'vitest'
import { parse, renderHtml, resolve } from '../src/index.js'
import fixtures from './fixtures/later-marker-note-continuation.json'

const normalized = (html: string) => html.replace(/>\s+</g, '><').trim()

for (const row of fixtures) {
  it(`keeps a later marker in the continued note paragraph: ${row.id}`, () => {
    expect(normalized(renderHtml(resolve(parse(row.source))))).toBe(normalized(row.html))
    expect(normalized(renderHtml(resolve(parse(row.source, { positions: true }))))).toBe(normalized(row.html))
  })
}
