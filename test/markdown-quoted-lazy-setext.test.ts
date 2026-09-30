import { expect, test } from 'vitest'
import { markdownToCarve, carveToHtml } from '../src/index.js'

test('an unmarked setext underline stays in the open quoted paragraph', () => {
  expect(carveToHtml(markdownToCarve('> foo\nbar\n===\n'))).toBe('<blockquote><p>foo\nbar\n===</p></blockquote>')
})

test('a blank ends the quote before a setext heading', () => {
  expect(markdownToCarve('> foo\n\nbar\n===\n')).toContain('# bar')
})

test('a table-shaped lazy continuation remains in the quoted paragraph', () => {
  expect(carveToHtml(markdownToCarve('> foo\nbar | baz\n--- | ---\n'))).toBe('<blockquote><p>foo\nbar | baz\n--- | ---</p></blockquote>')
})
