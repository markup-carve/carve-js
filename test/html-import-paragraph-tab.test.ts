import { expect, it } from 'vitest'
import { carveToHtml, htmlToCarve } from '../src/index.js'

it('preserves a literal tab inside imported paragraph text', () => {
  const html = '<p>\\\t\\A\\a\\ \\3\\φ\\«</p>'
  const source = htmlToCarve(html).value
  expect(source).toContain('\t')
  expect(carveToHtml(source)).toContain('\t')
  const spaced = htmlToCarve(html.replace('\t', ' ')).value
  expect(spaced).not.toContain('\t')
  expect(carveToHtml(spaced)).not.toContain('\t')
})
