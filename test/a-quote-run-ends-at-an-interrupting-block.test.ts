import { expect, it } from 'vitest'
import { parse, renderHtml, resolve } from '../src/index.js'
import fixtures from './fixtures/quote-run-interrupting-block.json'

const normalized = (html: string) => html.replace(/>\s+</g, '><').trim()

// Expected HTML is the spec repo's executable reading (scripts/spec) at carve 2d473af7.
for (const row of fixtures) {
  it(`gives the block below an over-indented quote its own base: ${row.id}`, () => {
    expect(normalized(renderHtml(resolve(parse(row.source))))).toBe(normalized(row.html))
    expect(normalized(renderHtml(resolve(parse(row.source, { positions: true }))))).toBe(normalized(row.html))
  })
}
