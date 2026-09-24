import { describe, expect, it } from 'vitest'
import {
  citations,
  codeCallouts,
  fromAstJson,
  renderAnsi,
  renderHtml,
  renderPlainText,
} from '../src/index.js'

describe('nested interchange content', () => {
  it('lifts footnotes from sections and table cells before rendering', () => {
    const doc = fromAstJson({ type: 'document', srcByteLength: 0, children: [{
      type: 'section', children: [{ type: 'table', rows: [{ type: 'table_row', cells: [{
        type: 'table_cell', header: false, blocks: [
          { type: 'paragraph', children: [{ type: 'footnote_ref', label: 'note' }] }, {
          type: 'footnote', label: 'note', children: [{ type: 'paragraph', children: [{ type: 'text', value: 'Nested note' }] }],
        }],
      }] }] }],
    }] } as never)
    expect(doc.footnoteDefs?.note).toHaveLength(1)
    expect(renderHtml(doc)).toContain('Nested note')
  })

  it('keeps the first footnote definition across root and nested containers', () => {
    const note = (value: string) => ({ type: 'footnote', label: 'same', children: [
      { type: 'paragraph', children: [{ type: 'text', value }] },
    ] })
    const doc = fromAstJson({ type: 'document', srcByteLength: 0, children: [
      { type: 'section', children: [note('first')] },
      { type: 'section', children: [note('second')] },
      note('third'),
    ] } as never)
    expect(doc.footnoteDefs?.same).toEqual([{ type: 'paragraph', children: [{ type: 'text', value: 'first' }] }])
  })

  it('does not treat nested frontmatter as document frontmatter', () => {
    const doc = fromAstJson({ type: 'document', srcByteLength: 0, children: [
      { type: 'div', children: [{ type: 'frontmatter', format: 'yaml', content: 'nested: true' }] },
      { type: 'frontmatter', format: 'toml', content: 'root = true' },
    ] } as never)
    expect(doc.frontmatter).toEqual({ format: 'toml', content: 'root = true' })
  })

  it('finds citation definitions and code callouts in block cells', () => {
    const doc = fromAstJson({ type: 'document', srcByteLength: 0, children: [
      { type: 'paragraph', children: [{ type: 'citation_group', raw: '[@ref]', items: [
        { type: 'citation', key: 'ref', suppressAuthor: false },
      ] }] },
      { type: 'table', rows: [{ type: 'table_row', cells: [{ type: 'table_cell', header: false, blocks: [
        { type: 'citation_definition', key: 'ref', children: [
          { type: 'text', value: 'Nested entry ' },
          { type: 'citation_group', raw: '[@other]', items: [{ type: 'citation', key: 'other', suppressAuthor: false }] },
        ] },
        { type: 'citation_definition', key: 'other', children: [{ type: 'text', value: 'Other entry' }] },
        { type: 'code_block', content: 'foo <1>' },
        { type: 'paragraph', children: [{ type: 'text', value: '<1> note' }] },
      ] }] }] },
    ] } as never)
    const cite = citations()
    cite.afterParse?.(doc)
    cite.beforeRender?.(doc, {} as never)
    const callouts = codeCallouts()
    callouts.afterParse?.(doc)
    const html = renderHtml(doc, { extensions: [cite, callouts] })
    expect(html).toContain('Nested entry')
    expect(html).not.toContain('Other entry')
    expect(html).toContain('class="callouts"')
  })

  it('finds citation definitions inside lifted footnote bodies', () => {
    const doc = fromAstJson({ type: 'document', srcByteLength: 0, children: [
      { type: 'paragraph', children: [{ type: 'citation_group', raw: '[@ref]', items: [
        { type: 'citation', key: 'ref', suppressAuthor: false },
      ] }] },
      { type: 'section', children: [{ type: 'footnote', label: 'n', children: [
        { type: 'citation_definition', key: 'ref', children: [{ type: 'text', value: 'Footnote entry' }] },
      ] }] },
    ] } as never)
    const cite = citations()
    cite.afterParse?.(doc)
    cite.beforeRender?.(doc, {} as never)
    expect(renderHtml(doc, { extensions: [cite] })).toContain('Footnote entry')
  })

  it('lets document citation definitions override footnote definitions', () => {
    const doc = fromAstJson({ type: 'document', srcByteLength: 0, children: [
      { type: 'paragraph', children: [{ type: 'citation_group', raw: '[@ref]', items: [
        { type: 'citation', key: 'ref', suppressAuthor: false },
      ] }] },
      { type: 'footnote', label: 'n', children: [
        { type: 'citation_definition', key: 'ref', children: [{ type: 'text', value: 'Footnote entry' }] },
      ] },
      { type: 'citation_definition', key: 'ref', children: [{ type: 'text', value: 'Document entry' }] },
    ] } as never)
    const cite = citations()
    cite.afterParse?.(doc)
    cite.beforeRender?.(doc, {} as never)
    const html = renderHtml(doc, { extensions: [cite] })
    expect(html).toContain('Document entry')
    expect(html).not.toContain('Footnote entry')
  })

  it('keeps nonbreaking spaces when flattening block cells', () => {
    const doc = fromAstJson({ type: 'document', srcByteLength: 0, children: [{
      type: 'table', rows: [{ type: 'table_row', cells: [
        { type: 'table_cell', header: false, blocks: [{ type: 'paragraph', children: [{ type: 'text', value: 'A\u00a0' }] }] },
        { type: 'table_cell', header: false, children: [{ type: 'text', value: 'B' }] },
      ] }] },
    ] } as never)
    expect(renderPlainText(doc)).toContain('A\u00a0')
    expect(renderAnsi(doc)).toContain('A\u00a0')
  })

  it('folds whitespace-only lines to one space in plain cells', () => {
    const doc = fromAstJson({ type: 'document', srcByteLength: 0, children: [{
      type: 'table', rows: [{ type: 'table_row', cells: [{
        type: 'table_cell', header: false, blocks: [{ type: 'code_block', content: 'a\n   \nb' }],
      }] }],
    }] } as never)
    expect(renderPlainText(doc)).toContain('a b')
  })
})
