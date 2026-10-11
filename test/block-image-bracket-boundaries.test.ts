import { expect, it } from 'vitest'
import { carveToHtml, parse, renderHtml, renderCarveWithReport, resolve } from '../src/index.js'
import controls from './fixtures/block-image-bracket-boundaries.json'

// These goldens were checked separately against native Carve bracket boundaries.
it.each(controls)('keeps block-image bracket boundaries: $source', ({ source, html }) => {
  expect(carveToHtml(source)).toBe(html)
  const ast = resolve(parse(source))
  expect(renderHtml(ast)).toBe(html)
  const formatted = renderCarveWithReport(ast)
  expect(formatted.losses).toEqual([])
  expect(formatted.totalLosses).toBe(0)
  expect(carveToHtml(formatted.value)).toBe(html)
})
