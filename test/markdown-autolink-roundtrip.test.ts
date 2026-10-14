import { expect, it } from 'vitest'
import { carveToMarkdown, markdownToCarve, renderMarkdown } from '../src/index.js'
import { fromAstJson } from '../src/ast-json.js'

it.each([
  '<https://github.com/markup-carve>',
  '<https://example.com/path?q=1>',
  '<https://example.com/path?a=1&b=2>',
  '<HTTPS://EXAMPLE.COM>',
  '<user@example.com>',
  '<mailto:user@example.com>',
])('keeps a representable autolink through Markdown: %s', source => {
  expect(carveToMarkdown(source).trimEnd()).toBe(source)
  expect(markdownToCarve(carveToMarkdown(source)).trimEnd()).toBe(source)
})

it.each([
  ['<https://example.com?a=1&copy;>', '[https://example.com?a=1\\&copy;](https://example.com?a=1&amp;copy;)'],
  ['<https://example.com>{title="Example"}', '[https://example.com](https://example.com "Example")'],
  ['<https://example.com/a(b)>', '[https://example.com/a(b)](https://example.com/a%28b%29)'],
  ['<javascript:alert1>', '[javascript:alert1]()'],
  ['<user@-x.com>', '[user@-x.com](mailto:user@-x.com)'],
  ['<user@x-.com>', '[user@x-.com](mailto:user@x-.com)'],
])('uses an explicit link when an angle autolink cannot carry the same content: %s', (source, expected) => {
  expect(carveToMarkdown(source).trimEnd()).toBe(expected)
})

it('keeps an authored explicit link explicit even when its label is the destination', () => {
  const source = '[https://example.com](https://example.com)'
  expect(carveToMarkdown(source).trimEnd()).toBe(source)
})

it('falls back when an email destination needs encoding', () => {
  const document = fromAstJson({
    type: 'document', srcByteLength: 0,
    children: [{ type: 'paragraph', children: [{ type: 'autolink', text: 'a|b@example.com', href: 'mailto:a|b@example.com' }] }],
  })
  expect(renderMarkdown(document)).toBe('[a|b@example.com](mailto:a%7Cb@example.com)\n')
})
