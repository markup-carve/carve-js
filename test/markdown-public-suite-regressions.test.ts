import { expect, it } from 'vitest'
import { carveToHtml, markdownToCarve } from '../src/index.js'

it.each([
  ['>\t\tfoo\n', '<blockquote>\n  <pre><code>  foo\n</code></pre>\n</blockquote>'],
  ['   > > 1.  one\n>>\n>>     two\n', '<blockquote>\n  <blockquote>\n    <ol>\n      <li><p>one</p>\n        <p>two</p>\n      </li>\n    </ol>\n  </blockquote>\n</blockquote>'],
  ['>>- one\n>>\n  >  > two\n', '<blockquote>\n  <blockquote>\n    <ul>\n      <li>one</li>\n    </ul>\n    <p>two</p>\n  </blockquote>\n</blockquote>'],
  ['[foo<https://example.com/?search=](uri)>\n', '<p>[foo<a href="https://example.com/?search=%5D(uri)">https://example.com/?search=](uri)</a></p>'],
  ['[foo<https://example.com/?search=][ref]>\n\n[ref]: /uri\n', '<p>[foo<a href="https://example.com/?search=%5D%5Bref%5D">https://example.com/?search=][ref]</a></p>'],
  ['[foo][bar][baz]\n\n[baz]: /url\n', '<p>[foo]<a href="/url">bar</a></p>'],
  ['[foo][bar][baz]\n\n[baz]: /url1\n[bar]: /url2\n', '<p><a href="/url2">foo</a><a href="/url1">baz</a></p>'],
  ['[foo][bar][baz]\n\n[baz]: /url1\n[foo]: /url2\n', '<p>[foo]<a href="/url1">bar</a></p>'],
  ['[a][b&amp;c]\n\n[b&amp;c]: /u', '<p><a href="/u">a</a></p>'],
  ['[a][b\\*c]\n\n[b\\*c]: /u', '<p><a href="/u">a</a></p>'],
  ['[a [b]][Foo  BAR]\n\n[foo bar]: /u', '<p><a href="/u">a [b]</a></p>'],
  ['[a][b][c][d]\n\n[b]: /b\n[c]: /c', '<p><a href="/b">a</a>[c][d]</p>'],
  ['[a][b][c][]\n\n[b]: /b\n[c]: /c', '<p><a href="/b">a</a><a href="/c">c</a></p>'],
  ['[x*][a][b][c]\n\n[a]: /a\n[c]: /c', '<p><a href="/a">x*</a><a href="/c">b</a></p>'],
  ['<https://a.com/\\(x)>', '<p><a href="https://a.com/%5C(x)">https://a.com/\\(x)</a></p>'],
  ['[a][b][c](/x)\n\n[b]: /b\n[c]: /c', '<p><a href="/b">a</a><a href="/x">c</a></p>'],
])('preserves the rendered meaning of a public Markdown case: %s', (source, expected) => {
  expect(carveToHtml(markdownToCarve(source))).toBe(expected)
})
