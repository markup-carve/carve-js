import { expect, it } from 'vitest'
import { parse, renderCarve, renderHtml } from '../src/index.js'
import type { Document, InlineNode } from '../src/ast.js'

it.each(['a\\', 'a\\\\\\'])('keeps adjacent code values separate: %s', value => {
  const children: InlineNode[] = [{ type: 'code', value }, { type: 'code', value: 'b' }]
  for (const inlines of [children, [{ type: 'strong', children }] as InlineNode[]]) {
    const document: Document = { type: 'document', children: [{ type: 'paragraph', children: inlines }] }
    expect(renderHtml(parse(renderCarve(document)))).toBe(renderHtml(document).replace(/\r\n?/g, '\n'))
  }
})

it.each(['a\n\nb', 'a\r\rb', 'a\r\n\r\nb', '\n\nb', 'a\n\n'])('keeps blank code lines inside a line block: %s', value => {
  const document: Document = { type: 'document', children: [{ type: 'paragraph', children: [{ type: 'code', value }] }] }
  document.children = [{ type: 'line_block', children: document.children }]
  expect(renderHtml(parse(renderCarve(document)))).toBe(renderHtml(document).replace(/\r\n?/g, '\n'))
})

it('keeps an escaped literal backtick before a code span', () => {
  const document: Document = { type: 'document', children: [{ type: 'paragraph', children: [{ type: 'text', value: 'a`' }, { type: 'code', value: 'b' }] }] }
  expect(renderHtml(parse(renderCarve(document)))).toBe(renderHtml(document).replace(/\r\n?/g, '\n'))
})

it.each(['code', 'math', 'literal_inline'] as const)('separates a %s closer across empty siblings', kind => {
  const first: InlineNode = kind === 'code' ? { type: 'code', value: 'a\\' } : kind === 'math' ? { type: 'math', content: 'a\\', display: false } : { type: 'literal_inline', content: 'a\\' }
  for (const empty of [[], [{ type: 'text', value: '' }], [{ type: 'small_caps', children: [] }]] as InlineNode[][]) {
    const document: Document = { type: 'document', children: [{ type: 'paragraph', children: [first, ...empty, { type: 'code', value: 'b' }] }] }
    expect(renderHtml(parse(renderCarve(document)))).toBe(renderHtml({ ...document, children: [{ type: 'paragraph', children: [first, { type: 'code', value: 'b' }] }] }))
  }
})

it.each(['code', 'math', 'literal_inline'] as const)('separates code after a transparent wrapper ending in %s', kind => {
  const first: InlineNode = kind === 'code' ? { type: 'code', value: 'a\\' } : kind === 'math' ? { type: 'math', content: 'a\\', display: false } : { type: 'literal_inline', content: 'a\\' }
  const document: Document = { type: 'document', children: [{ type: 'paragraph', children: [{ type: 'small_caps', children: [first, { type: 'text', value: '' }] }, { type: 'code', value: 'b' }] }] }
  const written = renderCarve(document)
  expect(written).toContain('{%  %}')
  const flattened: Document = { type: 'document', children: [{ type: 'paragraph', children: [first, { type: 'code', value: 'b' }] }] }
  expect(renderHtml(parse(written))).toBe(renderHtml(flattened))
})
