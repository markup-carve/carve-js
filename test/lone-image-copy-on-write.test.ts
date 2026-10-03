import { expect, it } from 'vitest'
import type { BlockNode, Document, Figure, DefinitionList } from '../src/ast.js'
import { collapseLoneImageParagraphs } from '../src/heading-ids.js'
import { renderHtml } from '../src/render-html.js'
import { RenderDepthError } from '../src/render-depth.js'

const imageParagraph = (): BlockNode => ({
  type: 'paragraph', children: [{ type: 'image', src: '/a.png', alt: 'A' }],
})

it('collapses an image inside a figure target without changing the caller', () => {
  const figure: Figure = {
    type: 'figure', target: { type: 'block_quote', children: [imageParagraph()] },
    caption: [],
  }
  const doc: Document = { type: 'document', children: [figure] }
  const collapsed = collapseLoneImageParagraphs(doc).children[0] as Figure
  expect(collapsed.target.type).toBe('block_quote')
  if (collapsed.target.type !== 'block_quote' || figure.target.type !== 'block_quote') throw new Error('Expected quote target')
  expect(collapsed.target.children[0]?.type).toBe('image')
  expect(figure.target.children[0]?.type).toBe('paragraph')
})

it('keeps definition bodies aligned when only the second body changes', () => {
  const first: BlockNode[] = [{ type: 'paragraph', children: [{ type: 'text', value: 'first' }] }]
  const second = [imageParagraph()]
  const list: DefinitionList = {
    type: 'definition_list',
    items: [{ terms: [[{ type: 'text', value: 'term' }]], definitions: [first, second] }],
  }
  const doc: Document = { type: 'document', children: [list] }
  const collapsed = collapseLoneImageParagraphs(doc).children[0] as DefinitionList
  expect(collapsed.items[0]?.definitions[0]).toEqual(first)
  expect(collapsed.items[0]?.definitions[1]?.[0]?.type).toBe('image')
  expect(second[0]?.type).toBe('paragraph')
})

it('keeps lone images inside verse as paragraphs', () => {
  const doc: Document = { type: 'document', children: [{ type: 'line_block', children: [imageParagraph()] }] }
  expect(collapseLoneImageParagraphs(doc)).toBe(doc)
})

it('refuses an over-depth tree after iterative image collapse', () => {
  let node = imageParagraph()
  for (let i = 0; i < 2000; i++) node = { type: 'div', children: [node] }
  const doc: Document = { type: 'document', children: [node] }
  expect(() => renderHtml(doc)).toThrow(RenderDepthError)
})

it('visits shared child lists once when checking for lone images', () => {
  let reads = 0
  let node: BlockNode = { type: 'paragraph', children: [{ type: 'text', value: 'text' }] }
  for (let i = 0; i < 18; i++) {
    const children: BlockNode[] = [node, node]
    node = { type: 'div', get children(): BlockNode[] { reads++; return children } }
  }
  const doc: Document = { type: 'document', children: [node] }
  expect(collapseLoneImageParagraphs(doc)).toBe(doc)
  expect(reads).toBeLessThan(100)
})

it('collapses a shared subtree once without changing its original leaf', () => {
  let reads = 0
  const original = imageParagraph()
  let node = original
  for (let i = 0; i < 18; i++) {
    const children: BlockNode[] = [node, node]
    node = { type: 'div', get children(): BlockNode[] { reads++; return children } }
  }
  const doc: Document = { type: 'document', children: [node] }
  let collapsed = collapseLoneImageParagraphs(doc).children[0]!
  expect(reads).toBeLessThan(500)
  while (collapsed.type === 'div') collapsed = collapsed.children[0]!
  expect(collapsed.type).toBe('image')
  expect(original.type).toBe('paragraph')
})
