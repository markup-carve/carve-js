import { expect, it } from 'vitest'
import { carveToHtml, parse, renderHtml, resolve } from '../src/index.js'
import rows from './fixtures/quoted-div-comment-fence-column.json'

// HTML from the spec model at carve 8eebed97 (carve-js#3918): after a comment in a quoted item, a fence at
// its div's column opens a code block, so an unmarked line after it ends the quote.
const flat = (html: string): string => html.replace(/>\s+</g, '><').trim()

it.each(rows)('$name', ({ source, html }) => {
  expect(flat(carveToHtml(source))).toBe(flat(html))
  expect(flat(renderHtml(resolve(parse(source, { positions: true }))))).toBe(flat(html))
})
