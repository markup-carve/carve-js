import { expect, it } from 'vitest'
import { carveToHtml, markdownToCarve } from '../src/index.js'

it.each([
  ['[link](/url (title))', '<p><a href="/url" title="title">link</a></p>'],
  ['[link](   /uri\n  "title"  )', '<p><a href="/uri" title="title">link</a></p>'],
  ['[link](/url (a &quot;quote&quot;))', '<p><a href="/url" title="a &quot;quote&quot;">link</a></p>'],
])('converts a Markdown link title: %s', (source, expected) => {
  expect(carveToHtml(markdownToCarve(source))).toBe(expected)
})

it('keeps a list tight when a link title joins its continuation', () => {
  expect(carveToHtml(markdownToCarve('- [a](/u\n  "t")\n- b'))).toBe('<ul>\n  <li><a href="/u" title="t">a</a></li>\n  <li>b</li>\n</ul>')
})

it('accepts a newline after a link title', () => {
  expect(carveToHtml(markdownToCarve('[a](/u\n"t"\n)'))).toBe('<p><a href="/u" title="t">a</a></p>')
})

it.each([
  ['[a](/u\n(title))', '<p><a href="/u" title="title">a</a></p>'],
  ['[a](/u (ti\ntle))', '<p><a href="/u" title="ti\ntle">a</a></p>'],
])('accepts newlines around parenthesized titles: %s', (source, expected) => {
  expect(carveToHtml(markdownToCarve(source))).toBe(expected)
})
