import { expect, it } from 'vitest'
import { parse, renderHtml, resolve } from '../src/index.js'
import fixtures from './fixtures/nested-note-later-code.json'

const normalized = (html: string) => html.replace(/>\s+</g, '><').trim()

// CARVE-P0-009: a nested note body that ends in a code block holds no open
// paragraph, however many code blocks it holds and whatever separates them.
for (const row of fixtures) {
  it(`ends the list after a nested note's later code block: ${row.id}`, () => {
    expect(normalized(renderHtml(resolve(parse(row.source))))).toBe(normalized(row.html))
    expect(normalized(renderHtml(resolve(parse(row.source, { positions: true }))))).toBe(normalized(row.html))
  })
}
