import { expect, it } from 'vitest'
import { carveToCarve, carveToHtml, markdownToCarve } from '../src/index.js'

// A lazy line of an item's paragraph is converted with the item's first line,
// so a code span, a quote or a setext underline reads across it (CommonMark 5.2).
it.each([
  // carve#4920
  ['- `c\n d`\n', '- `c d`\n'],
  // carve#4943
  [' - foo\nbar\n   ===\n', '- # foo bar\n'],
  // carve#4945
  ['1. >>> foo\n   bar\nbaz\n   >>> qux\n', '1. > > > foo\n   > > > bar\n   > > > baz\n   > > > qux\n'],
  ['1. >> foo\nbaz\n   >> qux\n', '1. > > foo\n   > > baz\n   > > qux\n'],
  // A quote the nested item on the first line holds keeps that item's column.
  ['- - > foo\nbar\n', '- - > foo\n    > bar\n'],
  ['- - > foo\n  bar\n', '- - > foo\n    > bar\n'],
  ['-  - >> foo\n  bar\n', '- - > > foo\n    > > bar\n'],
])('takes a lazy line into the item: %j', (markdown, carve) => {
  const written = markdownToCarve(markdown)
  expect(written).toBe(carve)
  expect(carveToCarve(written)).toBe(written)
})

it('renders the lazy lines as the item paragraph', () => {
  expect(carveToHtml(markdownToCarve('- `c\n d`\n'))).toBe('<ul>\n  <li><code>c d</code></li>\n</ul>')
  expect(carveToHtml(markdownToCarve(' - foo\nbar\n   ===\n'))).toBe('<ul>\n  <li>\n    <h1 id="foo-bar">foo bar</h1>\n  </li>\n</ul>')
})

it.each([
  ['- foo\n-\n- bar\n', '<ul>\n  <li>foo</li>\n  <li></li>\n  <li>bar</li>\n</ul>'],
  ['1. foo\n2.\n3. bar\n', '<ol>\n  <li>foo</li>\n  <li></li>\n  <li>bar</li>\n</ol>'],
])('leaves an empty sibling marker out of the item: %j', (markdown, html) => {
  expect(carveToHtml(markdownToCarve(markdown))).toBe(html)
})
