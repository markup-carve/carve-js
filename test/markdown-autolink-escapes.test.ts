import { expect, it } from 'vitest'
import { carveToHtml, markdownToCarve } from '../src/index.js'

it.each([
  ['<https://example.com/\\[\\>', '<p><a href="https://example.com/%5C%5B%5C">https://example.com/\\[\\</a></p>'],
  ['<foo\\+@bar.example.com>', '<p>&lt;foo+@bar.example.com&gt;</p>'],
  ['<foo+@bar.example.com>', '<p><a href="mailto:foo+@bar.example.com">foo+@bar.example.com</a></p>'],
])('keeps Markdown autolink escape semantics: %s', (source, expected) => {
  expect(carveToHtml(markdownToCarve(source))).toBe(expected)
})

it.each([
  ['[t](<https://a.com/\\_x>)', '<p><a href="https://a.com/_x">t</a></p>'],
  ['[t](<https://a.com/\\x>)', '<p><a href="https://a.com/%5Cx">t</a></p>'],
  ['[t](https://z.com "<https://a.com/\\x>")', '<p><a href="https://z.com" title="&lt;https://a.com/\\x&gt;">t</a></p>'],
  ['[t](https://z.com "<https://a.com/\\>")', '<p><a href="https://z.com" title="&lt;https://a.com/&gt;">t</a></p>'],
])('keeps destination and title escapes distinct from autolinks: %s', (source, expected) => {
  expect(carveToHtml(markdownToCarve(source))).toBe(expected)
})

it.each(['\\>', '\\x>'])('keeps URI-looking reference titles literal: %s', ending => {
  const source = '[r]\n\n[r]: https://z.com "<https://a.com/' + ending + '"'
  const title = ending === '\\>' ? '&lt;https://a.com/&gt;' : '&lt;https://a.com/\\x&gt;'
  expect(carveToHtml(markdownToCarve(source))).toBe('<p><a href="https://z.com" title="' + title + '">r</a></p>')
})
