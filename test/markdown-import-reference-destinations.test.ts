import { expect, test } from 'vitest'
import { carveToHtml, markdownToCarve } from '../src/index.js'

test('a reference chain uses the final definition', () => {
  expect(carveToHtml(markdownToCarve('[a][b][c](/u)\n\n[c]: /v'))).toContain('<p>[a]<a href="/v">b</a>(/u)</p>')
})

test('a lazy line after a quoted definition leaves the quote', () => {
  expect(carveToHtml(markdownToCarve('> [a]: /u\nlazy'))).not.toContain('<blockquote><p>lazy</p></blockquote>')
  expect(carveToHtml(markdownToCarve('> [a]: /u\nlazy'))).toContain('<p>lazy</p>')
})

test('a multiline title in a list definition reaches the reference', () => {
  expect(carveToHtml(markdownToCarve('- [a]: /u\n  "t\n  t2"\n- [a]'))).toContain('title="t\nt2"')
})

test('a raw newline ends an angle destination', () => {
  expect(carveToHtml(markdownToCarve('[a](<a\nb>)\n---'))).toBe('<p>[a](&lt;a\nb&gt;)</p>\n<hr>')
  expect(carveToHtml(markdownToCarve('[a](<a\r\nb>)\r\n---'))).toBe('<p>[a](&lt;a\nb&gt;)</p>\n<hr>')
})

test('an angle destination inside a fence stays literal', () => {
  expect(markdownToCarve('```\n[a](<a\nb>)\n---\n```')).toContain('[a](<a\nb>)')
})

test('a second quoted run stays in the item when the definition already has a title', () => {
  expect(carveToHtml(markdownToCarve('- [a]: /u "t"\n  "x\n  y"\n- [a]'))).toContain('"x\ny"')
})

test('a multiline title does not split a heading reference', () => {
  expect(markdownToCarve('- [a]: /u\n  "t\n  t2"\n# [a]')).not.toContain('CARVEMDTITLEBREAK')
})

test('a reference chain without an inline destination keeps its established reading', () => {
  expect(carveToHtml(markdownToCarve('[a][b][c]\n\n[c]: /v'))).toContain('<p>[a]<a href="/v">b</a></p>')
})
