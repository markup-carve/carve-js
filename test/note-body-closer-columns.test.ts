import { expect, it } from 'vitest'
import { carveToHtml, parse, renderHtml, resolve } from '../src/index.js'
import rows from './fixtures/note-body-closer-columns.json'

// HTML from the spec model at carve 8eebed97 (carve-js#3923): an unclosed `%%%` in a note body leaves its
// paragraph open, and a fence run past its opener or below its owner's column does not close it (CARVE-P2-006).
const flat = (html: string): string => html.replace(/>\s+</g, '><').trim()

it.each(rows)('$name', ({ source, html }) => {
  expect(flat(carveToHtml(source))).toBe(flat(html))
  expect(flat(renderHtml(resolve(parse(source, { positions: true }))))).toBe(flat(html))
})
