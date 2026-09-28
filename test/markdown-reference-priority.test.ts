import { expect, it } from 'vitest'
import { carveToHtml, markdownToCarve } from '../src/index.js'

it.each([
  ['[x](\\&amp;)', '<p><a href="&amp;amp;">x</a></p>'],
  ['[x]\n\n[x]: \\&amp;', '<p><a href="&amp;amp;">x</a></p>'],
  ['[a](<b)c)', '<p>[a](&lt;b)c)</p>'],
  ['[x](<a b>"t")', '<p>[x](<a b>"t")</p>'],
  ['[a](<b>c)', '<p>[a](<b>c)</p>'],

  ['[x](a\\*b)', '<p><a href="a*b">x</a></p>'],

  ['[x](/f&ouml;&ouml; "f&ouml;&ouml;")', '<p><a href="/f%C3%B6%C3%B6" title="föö">x</a></p>'],
  ['[x]\n\n[x]: /f&ouml;&ouml;', '<p><a href="/f%C3%B6%C3%B6">x</a></p>'],
  ['[ΑΓΩ]: /φου\n\n[αγω]', '<p><a href="/%CF%86%CE%BF%CF%85">αγω</a></p>'],
  ['[x](foo\\bar)', '<p><a href="foo%5Cbar">x</a></p>'],
  ['[x](foo%20b&auml;)', '<p><a href="foo%20b%C3%A4">x</a></p>'],
  ['[x]("title")', '<p><a href="%22title%22">x</a></p>'],

  ['[foo](</a b>)\n\n[foo]: /r', '<p><a href="/a%20b">foo</a></p>'],
  ['[foo](not a link)\n\n[foo]: /r', '<p><a href="/r">foo</a>(not a link)</p>'],
  ['[foo][\n bar\n]\n\n[bar]: /r', '<p><a href="/r">foo</a></p>'],
  ['![foo][]\n\n[foo]: /image', '<img src="/image" alt="foo">'],

  ['[foo][]\n\n[foo]: /url "title"', '<p><a href="/url" title="title">foo</a></p>'],
  ['[Foo][]\n\n[foo]: /url "title"', '<p><a href="/url" title="title">Foo</a></p>'],
  ['[*foo* bar][]\n\n[*foo* bar]: /url "title"', '<p><a href="/url" title="title"><em>foo</em> bar</a></p>'],
  ['[foo][bar]\n\n[foo]: /url1\n[bar]: /url2', '<p><a href="/url2">foo</a></p>'],
  ['[foo][BaR]\n\n[bar]: /url "title"', '<p><a href="/url" title="title">foo</a></p>'],
  ['[foo](/inline)\n\n[foo]: /reference', '<p><a href="/inline">foo</a></p>'],
  ['[foo][missing]\n\n[foo]: /url', '<p>[foo][missing]</p>'],
])('resolves full and collapsed references before shortcuts: %s', (source, expected) => {
  expect(carveToHtml(markdownToCarve(source))).toBe(expected)
})

it('does not resolve an escaped reference label against a different spelling', () => {
  expect(carveToHtml(markdownToCarve('[bar][foo\\!]\n\n[foo!]: /url'))).not.toContain('<a ')
})
