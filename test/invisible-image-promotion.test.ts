import { expect, it } from 'vitest'
import { carveToHtml, djotToCarve, htmlToCarve, markdownToCarve } from '../src/index.js'

it.each([
  '{%%}![alt](x.png)',
  '%% hidden\n![alt](x.png)',
  '{%%}![alt][r]\n\n[r]: x.png',
])('promotes an image after invisible content: %s', source => {
  expect(carveToHtml(source)).toBe('<img src="x.png" alt="alt">')
})

it('imports image-only paragraphs as plain images', () => {
  expect(djotToCarve('![alt](x.png)')).toBe('![alt](x.png)')
  expect(markdownToCarve('![alt](x.png)')).toBe('![alt](x.png)')
  const result = htmlToCarve('<p><img src="x.png" alt="alt"></p>')
  expect(result.value.trim()).toBe('![alt](x.png)')
  expect(result.report.diagnostics).toEqual([])
})
