import { expect, it } from 'vitest'
import { carveToHtml, carveToMarkdown, markdownToCarve } from '../src/index.js'

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


it.each([
  ['[link](a(b))', '[link](a\\(b\\))'],
  ['[link](a\\(b)', '[link](a\\(b)'],
  ['[link](a\\)b)', '[link](a\\)b)'],
  ['[link](a(b(c)))', '[link](a\\(b\\(c\\)\\))'],
])('writes escaped parentheses without changing destination bytes: %s', (source, expected) => {
  expect(carveToMarkdown(source).trimEnd()).toBe(expected)
})
