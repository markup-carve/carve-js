import { expect, it } from 'vitest'
import { carveToHtml, parse, renderCarve, type Document, type InlineNode } from '../src/index.js'

const text = (value: string): InlineNode => ({ type: 'text', value })

it.each([
  { name: 'a lone span', children: [{ type: 'span', children: [text('word')] }] as InlineNode[], source: '[word]{}\n' },
  { name: 'a span beside text', children: [text('before '), { type: 'span', children: [text('word')] }, text(' after')] as InlineNode[], source: 'before [word]{} after\n' },
  { name: 'a span with formatted content', children: [{ type: 'span', children: [text('a '), { type: 'strong', children: [text('b')] }] }] as InlineNode[], source: '[a *b*]{}\n' },
])('keeps the brackets of $name without attributes', ({ children, source }) => {
  const doc: Document = { type: 'document', children: [{ type: 'paragraph', children }] }
  const written = renderCarve(doc)
  expect(written).toBe(source)
  expect(parse(written).children[0]).toMatchObject({ type: 'paragraph', children })
  expect(carveToHtml(written)).toContain('<span>')
})
