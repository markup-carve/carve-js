import { expect, it } from 'vitest'
import { carveToHtml, parse, renderHtml, resolve } from '../src/index.js'
import rows from './fixtures/rule-a-walk-follows-the-merged-model.json'

// HTML from the spec model at carve a831e1fd (carve#3896): a term is not a paragraph a marker
// continues (carve-js#3879); a task note and a `+` note read their body from the note's own column (carve-js#3880).
const flat = (html: string): string => html.replace(/>\s+</g, '><').trim()

it.each(rows)('$name', ({ source, html }) => {
  expect(flat(carveToHtml(source))).toBe(flat(html))
  expect(flat(renderHtml(resolve(parse(source, { positions: true }))))).toBe(flat(html))
})
