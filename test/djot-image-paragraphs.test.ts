import { expect, it } from 'vitest'
import { carveToHtml, carveToPlainText, djotToCarve, parse, renderCarve, renderCarveWithConversionReport } from '../src/index.js'

it.each([
  '![x](/u)',
  '{.p}\n![x](/u)',
  '> ![x](/u)',
  '- a\n\n  ![x](/u)',
  '![`x`](/u)',
  '| ![x](/u) |',
])('retains the imported image paragraph through native export: %s', source => {
  const converted = djotToCarve(source)
  const tree = parse(converted)
  expect(carveToHtml(renderCarve(tree))).toBe(carveToHtml(converted))
  expect(renderCarveWithConversionReport(tree).report.diagnostics).toEqual([])
  expect(carveToPlainText(converted)).toContain('x')
})

it('keeps tight image lists tight', () => {
  const html = carveToHtml(djotToCarve('- ![x](/u)'))
  expect(html).toContain('<li><img src="/u" alt="x"></li>')
  expect(html).not.toContain('<p>')
})

it('preserves the space between adjacent images', () => {
  expect(carveToHtml(djotToCarve('![x](/u) ![y](/v)'))).toBe('<p><img src="/u" alt="x"> <img src="/v" alt="y"></p>')
})
