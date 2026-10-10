import { expect, it } from 'vitest'
import { parse, renderCarve, renderHtml, SourceUnspellableError } from '../src/index.js'
import type { Document, InlineNode } from '../src/ast.js'

it.each(['a\\', 'a\\\\\\'])('keeps adjacent code values separate: %s', value => {
  const children: InlineNode[] = [{ type: 'code', value }, { type: 'code', value: 'b' }]
  for (const inlines of [children, [{ type: 'strong', children }] as InlineNode[]]) {
    const document: Document = { type: 'document', children: [{ type: 'paragraph', children: inlines }] }
    expect(renderHtml(parse(renderCarve(document)))).toBe(renderHtml(document).replace(/\r\n?/g, '\n'))
  }
})

it.each(['a\n\nb', 'a\r\rb', '\n\nb', 'a\n\n'])('refuses a paragraph code value with a blank line: %s', value => {
  const document: Document = { type: 'document', children: [{ type: 'paragraph', children: [{ type: 'code', value }] }] }
  expect(() => renderCarve(document)).toThrow(SourceUnspellableError)
  document.children = [{ type: 'line_block', children: document.children }]
  expect(renderHtml(parse(renderCarve(document)))).toBe(renderHtml(document).replace(/\r\n?/g, '\n'))
})

it('keeps an escaped literal backtick before a code span', () => {
  const document: Document = { type: 'document', children: [{ type: 'paragraph', children: [{ type: 'text', value: 'a`' }, { type: 'code', value: 'b' }] }] }
  expect(renderHtml(parse(renderCarve(document)))).toBe(renderHtml(document).replace(/\r\n?/g, '\n'))
})
