import { expect, it } from 'vitest'
import { carveToHtml, markdownToCarve } from '../src/index.js'

it.each([
  ["[a\nb](/u \"t\nx\")", "<p><a href=\"/u\" title=\"t\nx\">a\nb</a></p>"],
  ["> [a\n> b](/u \"t\n> x\")", "<blockquote><p><a href=\"/u\" title=\"t\nx\">a\nb</a></p></blockquote>"],

  ["[l](/u \"t\nx\")", "<p><a href=\"/u\" title=\"t\nx\">l</a></p>"],
  ["![a](/i \"t\nx\")", "<img src=\"/i\" alt=\"a\" title=\"t\nx\">"],
  ["[a](/u?q=&quot;x&quot;)", "<p><a href=\"/u?q=&quot;x&quot;\">a</a></p>"],
  ["> *foo\n> bar*", "<blockquote><p><em>foo\nbar</em></p></blockquote>"],
  ["- *foo\n  bar*", "<ul>\n  <li><em>foo\nbar</em></li>\n</ul>"],
  ["1. *foo\n   bar*", "<ol>\n  <li><em>foo\nbar</em></li>\n</ol>"],
  ["> [l](/u \"t\n> x\")", "<blockquote><p><a href=\"/u\" title=\"t\nx\">l</a></p></blockquote>"],
  ["- [l](/u \"t\n  x\")", "<ul>\n  <li><a href=\"/u\" title=\"t\nx\">l</a></li>\n</ul>"],
  ["[foo]: /url 'title\n\ntext'", "<p>[foo]: /url 'title</p>\n<p>text'</p>"],

  ['a*"foo"*', '<p>a*"foo"*</p>'],
  ['&quot;quoted&quot; and &#39;text&#39;', '<p>"quoted" and \'text\'</p>'],
  ['"hello" and \'goodbye\'', '<p>"hello" and \'goodbye\'</p>'],
  ['don\'t change "quotes"', '<p>don\'t change "quotes"</p>'],
  ['**foo "*bar*" foo**', '<p><strong>foo "<em>bar</em>" foo</strong></p>'],
  ['*foo **bar *baz* bim** bop*', '<p><em>foo <strong>bar <em>baz</em> bim</strong> bop</em></p>'],
  ['***outer _inner_ end***', '<p><em><strong>outer <em>inner</em> end</strong></em></p>'],
  ['foo __*__', '<p>foo <strong>*</strong></p>'],
  ['`"code"` and ["label"](/url "title")', '<p><code>"code"</code> and <a href="/url" title="title">"label"</a></p>'],
  ['<span title="quoted">"text"</span>', '<p><span title="quoted">"text"</span></p>'],
])('preserves imported inline meaning: %s', (source, expected) => {
  expect(carveToHtml(markdownToCarve(source)).trim()).toBe(expected)
})

it('preserves explicitly enabled attribute syntax', () => {
  expect(markdownToCarve('*word*{title="two words"}', { attributes: true })).toContain('{title="two words"}')
})

it('preserves prose quotes with attributes enabled', () => {
  const source = '\"hello\" \'x\' *word*{title="two words"}'
  expect(carveToHtml(markdownToCarve(source, { attributes: true }))).toBe('<p>"hello" \'x\' <em title="two words">word</em></p>')
})

it.each(['<span title="x  \ny">b</span>', '<!-- x  \ny -->'])('preserves spaces in raw HTML: %s', (html) => {
  const written = markdownToCarve('*a ' + html + '\nc*')
  expect(written).toContain(html)
  expect(written).not.toContain('x\\\ny')
})

it('keeps unattached attribute-looking text literal', () => {
  const source = '\"a\" {.c title="x y"} \'b\''
  expect(carveToHtml(markdownToCarve(source, { attributes: true }))).toBe('<p>"a" {.c title="x y"} \'b\'</p>')
})
