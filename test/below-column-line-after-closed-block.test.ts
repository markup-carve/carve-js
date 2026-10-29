import { expect, it } from 'vitest'
import { parse, renderHtml, resolve } from '../src/index.js'
import fixtures from './fixtures/below-column-line-after-closed-block.json'

const normalized = (html: string) => html.replace(/>\s+</g, '><').trim()

// CARVE-P0-009: a below-column line continues a paragraph only where one is
// open at the deepest frame. `basis` names the spec checker build each
// expected output was compared with.
for (const row of fixtures) {
  it(`reads the below-column line by the open paragraph: ${row.id}`, () => {
    expect(normalized(renderHtml(resolve(parse(row.source))))).toBe(normalized(row.html))
    expect(normalized(renderHtml(resolve(parse(row.source, { positions: true }))))).toBe(normalized(row.html))
  })
}
