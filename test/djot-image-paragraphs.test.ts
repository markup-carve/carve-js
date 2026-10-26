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
  expect(html).toContain('<img src="/u" alt="x">')
  expect(html).not.toContain('<p>')
})

it('preserves the space between adjacent images', () => {
  expect(carveToHtml(djotToCarve('![x](/u) ![y](/v)'))).toBe('<p><img src="/u" alt="x"> <img src="/v" alt="y"></p>')
})

it('preserves code following a multiline image inside a list quote', () => {
  const html = carveToHtml(djotToCarve('- > ![*a*\n  > b](x) `c\n  > d`'))
  expect(html).toContain('<img src="x" alt="a\nb"> <code>c\nd</code>')
})

it.each([
  '{%%}![a\n\\# b](u)',
  '{%%}![a\n\\::: b](u)',
  '{%%}![a\n\\> b](u)',
  '{%%}![a\n\\- b](u)',
  '{%%}![a\n1\\. b](u)',
  '{%%}![a\n\\%% b](u)',
  '{%%}![a\n\\[r\\]: b](u)',
])('preserves literal block markers in image alt text on export: %s', source => {
  const tree = parse(source)
  const result = renderCarveWithConversionReport(tree)
  expect(carveToHtml(result.value ?? '')).toBe(carveToHtml(source))
  expect(result.report.diagnostics).toEqual([])
})
