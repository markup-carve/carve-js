import { expect, it } from 'vitest'
import { htmlToCarve } from '../src/index.js'

// carve#3044, CARVE-P10-021: roundtrip consumes a refused generic-span carrier as safe does.
it.each([
  ['<p><span data-carve-raw="x y">z</span></p>', 'z\n', 'warning'],
  ['<p><span data-carve-escaped>ab</span></p>', 'ab\n', 'info'],
])('consumes %j', (html, carve, severity) => {
  const result = htmlToCarve(html, { mode: 'roundtrip' })
  expect(result.value).toBe(carve)
  expect(result.report.diagnostics).toContainEqual(expect.objectContaining({ code: 'attribute-dropped', severity }))
})

it('keeps a plain span raw in roundtrip and a valid carrier as its node', () => {
  expect(htmlToCarve('<p><span>z</span></p>', { mode: 'roundtrip' }).value).toBe('`<span>z</span>`{=html}\n')
  expect(htmlToCarve('<p><span data-carve-raw="tex">x</span></p>', { mode: 'roundtrip' }).value).toBe('`x`{=tex}\n')
})
