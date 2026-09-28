import { expect, it } from 'vitest'
import { carveToHtml, markdownToCarve } from '../src/index.js'

it.each([
  ['[link][r]\n\n[r]: <a)b>', 'a)b'],
  ['[link][r]\n\n[r]: <a(b>', 'a(b'],
  ['[link][r]\n\n[r]: a\\)b', 'a)b'],
  ['[link](\\(foo\\))', '(foo)'],
  ['[link](foo\\(and\\(bar\\))', 'foo(and(bar)'],
  ['[link](<a)b>)', 'a)b'],
  ['[link](a(b)c)', 'a(b)c'],
  ['[link](a%28b%29)', 'a%28b%29'],
])('preserves URL parentheses: %s', (source, href) => {
  expect(carveToHtml(markdownToCarve(source))).toBe(`<p><a href="${href}">link</a></p>`)
})
