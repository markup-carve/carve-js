import { expect, it } from 'vitest'
import { carveToHtml, parse, renderHtml, resolve } from '../src/index.js'
import rows from './fixtures/a-body-fence-closer-search-follows-the-model.json'

// HTML from the spec model at carve 86cc4e42: a body's closer search passes a line below the column, stops at
// a blank run before a short line, and counts only a closer at the body column (CARVE-P0-014, carve-js#3884).
const flat = (html: string): string => html.replace(/>\s+</g, '><').trim()

it.each(rows)('$name', ({ source, html }) => {
  expect(flat(carveToHtml(source))).toBe(flat(html))
  expect(flat(renderHtml(resolve(parse(source, { positions: true }))))).toBe(flat(html))
})
