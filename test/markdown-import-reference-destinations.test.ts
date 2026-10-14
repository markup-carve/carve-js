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
  expect(carveToHtml(markdownToCarve('- [a]: /u\n  "t\n  t2"\n# [A]'))).not.toContain('[A](/u “t')
  expect(carveToHtml(markdownToCarve('- [a]: /u\n  "t\n  t2"\n\n> # [a]'))).not.toContain('[a](/u “t')
  expect(carveToHtml(markdownToCarve('- [a]: /u\n  "t\n  t2"\n\n> | [a] |\n> |---|'))).not.toContain('[a](/u “t')
})

test('a reference chain does not erase a footnote opener', () => {
  const html = carveToHtml(markdownToCarve('[^1][b][c](/u)\n\n[c]: /v\n\n[^1]: note'))
  expect(html).toContain('role="doc-noteref"')
  expect(html).toContain('<a href="/v">b</a>(/u)')
})

test('a footnote chain rewrite leaves authored escapes and code intact', () => {
  expect(carveToHtml(markdownToCarve('[^1]\\[b\\][c](/u)\n\n[c]: /v\n\n[^1]: note'))).toContain('<a href="/u">c</a>')
  expect(markdownToCarve('```\n[^1]\\[b\\][c](/u)\n```\n\n[c]: /v')).toContain('[^1]\\[b\\][c](/u)')
  expect(markdownToCarve('`[^1]\\[b\\][c](/u)`\n\n[c]: /v')).toContain('[^1]\\[b\\][c](/u)')
  expect(carveToHtml(markdownToCarve('`x` [^1][b][c](/u)\n\n[c]: /v\n\n[^1]: note'))).toContain('<a href="/v">b</a>(/u)')
  expect(markdownToCarve('[^1][`b][c](/u)`\n\n[c]: /v')).toContain('`b][c](/u)`')
  expect(markdownToCarve('\\\\`[^1][b][c](/u)`\n\n[c]: /v')).toContain('`[^1][b][c](/u)`')
})

test('a raw newline angle shortcut leaves formatted labels on the normal path', () => {
  expect(carveToHtml(markdownToCarve('[*x*](<a\nb>)\n---'))).toBe('<p>[<em>x</em>](&lt;a\nb&gt;)</p>\n<hr>')
  expect(carveToHtml(markdownToCarve('[x-y](<a\nb>)\n---'))).toBe('<p>[x-y](&lt;a\nb&gt;)</p>\n<hr>')
})

test('an explicit reference outside the list keeps its multiline title', () => {
  expect(carveToHtml(markdownToCarve('- [Foo]: /u\n  "t\n  t2"\n\n[x][foo]'))).toContain('title="t\nt2"')
})

test('a reference chain without an inline destination keeps its established reading', () => {
  expect(carveToHtml(markdownToCarve('[a][b][c]\n\n[c]: /v'))).toContain('<p>[a]<a href="/v">b</a></p>')
})
