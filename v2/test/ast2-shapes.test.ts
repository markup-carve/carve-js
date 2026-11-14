import { describe, expect, it } from 'vitest'
import {
  type CitationGroupNode, type CitationNode, type ImageNode, type Inline, type ListItemNode, type ListNode,
  parseWithLayout, render, type TableCellNode, type TableNode, validateLayout, validateTree,
} from '../src/index.ts'
import { documentOf, paragraph, text } from './support/tree.ts'

describe('AST 2.0 shapes', () => {
  it('C2-A-115: decorative is true exactly when alt is absent', () => {
    const image = (fields: Record<string, unknown>): unknown => documentOf(paragraph({ type: 'image', ...fields }))
    expect(() => validateTree(image({ alt: '' }))).not.toThrow()
    expect(() => validateTree(image({ decorative: true }))).not.toThrow()
    expect(() => validateTree(image({ alt: '', decorative: true }))).toThrow('decorative is true exactly when alt is absent')
    expect(() => validateTree(image({ src: 'u' }))).toThrow('decorative is true exactly when alt is absent')
  })

  it('C2-H-080: a long image description follows its containing block', () => {
    const image: ImageNode = { type: 'image', src: 'u', alt: 'a', longDescription: [paragraph('Description')] }
    expect(render(documentOf(paragraph('before ', image)))).toBe('<p>before <img src="u" alt="a"></p>\n<p>Description</p>')
  })

  it('C2-A-092, C2-H-056: explicit scope and headerIds reach the table cells', () => {
    const header: TableCellNode = { type: 'table_cell', header: true, scope: 'colgroup', attrs: { id: 'h' }, children: [] }
    const data: TableCellNode = { type: 'table_cell', header: false, headerIds: ['h'], children: [] }
    const table: TableNode = {
      type: 'table', columns: [], children: [{ type: 'table_head', children: [{ type: 'table_row', children: [header, data] }] }],
    }
    const html = render(documentOf(table))
    expect(html).toContain('<th scope="colgroup" id="h"')
    expect(html).toContain('<td headers="h"')
  })

  it('C2-A-030, C2-A-120, C2-A-121: metadata and citation locator have closed typed shapes', () => {
    const citation: CitationNode = { type: 'citation', key: 'a', namespace: 'citation', mode: 'author-in-text', locator: {
      label: 'page', children: [text('3')],
    } }
    const group: CitationGroupNode = { type: 'citation_group', raw: '[@a, p. 3]', children: [citation] }
    const document = documentOf(paragraph(group), {
      type: 'citation_definition', key: 'a', namespace: 'citation', children: [],
      metadata: { bibliography: { title: [text('Book')], authors: ['A'], issued: '2026' } },
    })
    expect(() => validateTree(document)).not.toThrow()
    const invalidGroup = { ...group, mode: 'normal' } as unknown as Inline
    const invalidItem = { ...group, children: [{ ...citation, suppressAuthor: false }] } as unknown as Inline
    expect(() => validateTree(documentOf(paragraph(invalidGroup)))).toThrow('not a field of citation_group')
    expect(() => validateTree(documentOf(paragraph(invalidItem))))
      .toThrow('not a field of citation')
  })

  it('C2-A-181, C2-L-055: include values are decoded and their spelling is in layout', () => {
    const result = parseWithLayout('{{ a.crv @cols:"a,b" @shift:+2 @code }}')
    expect(result.document.children[0]).toMatchObject({ options: { cols: ['a', 'b'], shift: 2, code: true } })
    expect(result.layout.nodes.find((entry) => entry.path === '/children/0')?.optionSpelling)
      .toEqual({ cols: '"a,b"', shift: '+2' })
    expect(() => validateLayout(result.layout)).not.toThrow()
  })

  it('C2-H-032: a task item writes its declaration before an authored style', () => {
    const item: ListItemNode = { type: 'list_item', task: { mark: 'x' }, attrs: { keyValues: [['style', 'color: red']] },
      children: [paragraph('done')] }
    const list: ListNode = { type: 'list', marker: { kind: 'bullet', char: '-' }, spacing: 'tight', children: [item] }
    expect(render(documentOf(list))).toContain('class="task" style="list-style: none; color: red"')
  })
})
