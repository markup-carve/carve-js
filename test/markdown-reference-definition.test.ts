import { expect, it } from 'vitest'
import { readMarkdownReferenceDefinition } from '../src/markdown-reference-definition.js'

it.each([
  ['[a]: /url\nparagraph', { label: 'a', target: '/url', lines: 1, complex: false }],
  ['[a\\]]: /url "title"\n', { label: 'a\\]', target: '/url "title"', lines: 1, complex: true }],
  ['[a\nb]: /url\n', { label: 'a\nb', target: '/url', lines: 2, complex: true }],
  ['[a]: /url "line1\nline2"\n', { label: 'a', target: '/url "line1\nline2"', lines: 2, complex: true }],
])('reads a reference definition and its consumed lines: %s', (source, expected) => {
  expect(readMarkdownReferenceDefinition(source)).toEqual(expected)
})

it.each([
  '[a[b]]: /url',
  '[a]: <url>(suffix)',
  '[a]: <url\n>',
  '[a]: /url(unclosed',
  '[a]: /url "title" suffix',
  '    [a]: /url',
])('rejects malformed or indented definitions: %s', (source) => {
  expect(readMarkdownReferenceDefinition(source)).toBeNull()
})
