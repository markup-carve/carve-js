import { expect, it } from 'vitest'
import { carveToHtml, markdownToCarve } from '../src/index.js'

it.each([
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
