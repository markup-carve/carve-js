import { expect, it } from 'vitest'
import { carveToCarve, carveToHtml, markdownToCarve } from '../src/index.js'

// carve#4933: an empty item is a marker with nothing after it, wherever the
// marker stands (CommonMark 5.2, examples 278-283).
it.each([
  // A nested empty item on the item line.
  ['- - \n', '- - {empty}\n'],
  ['- 1.\n', '- 1. {empty}\n'],
  ['- a\n  - - \n', '- a\n  - - {empty}\n'],
  ['- *a\n  - - \n  b*\n', '- *a\n  - - {empty}\n  b*\n'],
  // An empty item in a quote the item holds.
  ['- > *\n', '- > * {empty}\n'],
  ['- >*\n', '- > * {empty}\n'],
  ['- > *\n  > *\n', '- > * {empty}\n  > * {empty}\n'],
  [' - >*\n\n   -\n', '- > * {empty}\n\n  - %%\n'],
  // An empty item takes no lazy line: what is left of its content leaves it.
  ['1.\n  para\n', '1. %%\n\npara\n'],
  ['-\n foo\n', '- %%\n\nfoo\n'],
  ['- -\nb\n', '- - {empty}\n\nb\n'],
])('reads an empty item: %j', (markdown, carve) => {
  const written = markdownToCarve(markdown)
  expect(written).toBe(carve)
  expect(carveToCarve(written)).toBe(written)
})

it.each([
  ['- *a\n  - - \n  b*\n', '<ul>\n  <li>*a\n    <ul>\n      <li>\n        <ul>\n          <li></li>\n        </ul>\n      </li>\n    </ul>\n    b*\n  </li>\n</ul>'],
  ['1.\n  para\n', '<ol>\n  <li></li>\n</ol>\n<p>para</p>'],
])('renders the empty item as CommonMark reads it: %j', (markdown, html) => {
  expect(carveToHtml(markdownToCarve(markdown))).toBe(html)
})

it('keeps a bare marker under a quoted paragraph as its text', () => {
  expect(carveToHtml(markdownToCarve('> para\n> *\n> - y\n'))).toContain('<p>para\n*</p>')
})

it('keeps a bare marker in a fence the item quote holds as code', () => {
  expect(markdownToCarve('- > ~~~\n  > *\n  > ~~~\n')).toBe('- > ```\n  > *\n  > ```\n')
})

it('keeps a private-use character the item text holds', () => {
  expect(markdownToCarve('- ab\n- > *\n')).toBe('- ab\n- > * {empty}\n')
})
