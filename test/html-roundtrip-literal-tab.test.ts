import { expect, it } from 'vitest'
import { carveToHtml, htmlToCarve } from '../src/index.js'

it('keeps the tab in an unresolved definition rendered as literal text', () => {
  const source = 'see [t][a]\n\n[a]: \t/u\n'
  const html = carveToHtml(source, { roundtrip: true })
  const imported = htmlToCarve(html, { mode: 'roundtrip' }).value
  expect(imported).toBe('see \\[t][a]\n\n[a]: \t/u\n')
  expect(carveToHtml(imported)).toBe(html)
})

it('keeps literal tabs beside inline elements and collapses line breaks', () => {
  const imported = htmlToCarve('<p>a\t<em>b</em>\t c\n d</p>', { mode: 'roundtrip' }).value
  expect(imported).toBe('a\t/b/\t c d\n')
})

it('collapses tab indentation in a whitespace run containing an HTML line break', () => {
  expect(htmlToCarve('<p>\n\t\tfoo\n\tbar\n\t</p>', { mode: 'roundtrip' }).value).toBe('foo bar\n')
})
