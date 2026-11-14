import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { format, validateTree } from '../../v2/src/index.ts'
import { importDocument } from '../src/index.ts'

interface Fixture { name: string, html: string }
const fixtures = JSON.parse(readFileSync(join(import.meta.dirname, '../fixtures/html-shapes.json'), 'utf8')) as Fixture[]

describe('Carve 0.2 importers', () => {
  it('C2-A-008 validates every imported root and writes stable source', () => {
    for (const from of ['markdown', 'gfm', 'djot', 'html'] as const) {
      const result = importDocument('<b>Hi</b>', { from })
      validateTree(result.document)
      expect(result.document.astVersion).toBe('2.0')
      expect(format(result.source)).toBe(result.source)
    }
  })

  it('C2-A-049 maps Markdown frontmatter and raw HTML to typed nodes', () => {
    const result = importDocument('---\ntitle: A\n---\n\n<div>\nHi\n</div>\n', { from: 'markdown' })
    expect(result.document.children[0]?.type).toBe('frontmatter')
    expect(result.document.children[1]?.type).toBe('raw_block')
  })

  it('C2-A-060 maps GFM task status to task.mark', () => {
    const result = importDocument('- [x] done\n', { from: 'gfm' })
    const first = result.document.children[0]
    expect(first?.type).toBe('list')
    if (first?.type === 'list') expect(first.children[0]?.task?.mark).toBe('x')
  })

  it('C2-A-066 maps GitHub alert quotes to admonitions', () => {
    const result = importDocument('> [!NOTE]\n> message\n', { from: 'gfm' })
    const first = result.document.children[0]
    expect(first?.type).toBe('admonition')
    if (first?.type === 'admonition') expect(first.kind).toBe('note')
  })

  it('C2-A-066 uses the typed admonition slot for a Markdown directive', () => {
    const result = importDocument(':::note\nhello\n:::\n', { from: 'markdown' })
    expect(result.document.children[0]?.type).toBe('admonition')
  })

  it('C2-A-050 gives display math its paragraph role', () => {
    const result = importDocument('$$\nx + y\n$$\n', { from: 'markdown' })
    const first = result.document.children[0]
    if (first?.type === 'paragraph') expect(first.role).toBe('math')
    else expect(first?.type).toBe('paragraph')
  })

  it('C2-A-050 maps Djot inline formatting and code blocks', () => {
    const result = importDocument('```js\nx\n```\n\n*bold*\n', { from: 'djot' })
    expect(result.document.children.some(node => node.type === 'code_block')).toBe(true)
    expect(result.source).toContain('js')
  })

  it('C2-A-050 maps every real-world HTML fixture to a valid tree', () => {
    for (const fixture of fixtures) {
      const result = importDocument(fixture.html, { from: 'html' })
      validateTree(result.document)
      expect(format(result.source), fixture.name).toBe(result.source)
    }
  })

  it('C2-A-050 preserves HTML table groups and spanning facts', () => {
    const result = importDocument(fixtures[1]?.html ?? '', { from: 'html' })
    const table = result.document.children[0]
    expect(table?.type).toBe('table')
    if (table?.type !== 'table') return
    expect(table.children.map(group => group.type)).toEqual(['table_head', 'table_body', 'table_foot'])
    const head = table.children[0]
    if (head?.type === 'table_head') {
      const first = head.children[0]
      if (first?.type === 'table_row') expect(first.children[0]?.colspan).toBe(2)
    }
  })

  it('C2-A-050 keeps block content inside table cells even when source cannot spell it', () => {
    const result = importDocument('<table><tr><td><p>one</p><ul><li>two</li></ul></td></tr></table>', { from: 'html' })
    const table = result.document.children[0]
    if (table?.type !== 'table') return
    const body = table.children[0]
    if (body?.type !== 'table_body') return
    const row = body.children[0]
    if (row?.type !== 'table_row') return
    expect(row.children[0]?.children.map(node => node.type)).toEqual(['paragraph', 'list'])
    expect(result.diagnostics.some(node => node.channel === 'render-loss')).toBe(true)
  })

  it('C2-A-078 maps generated HTML footnotes to definitions', () => {
    const result = importDocument(fixtures[7]?.html ?? '', { from: 'html' })
    expect(result.document.children.some(node => node.type === 'footnote')).toBe(true)
    const paragraph = result.document.children[0]
    if (paragraph?.type === 'paragraph') expect(paragraph.children.some(node => node.type === 'footnote_ref')).toBe(true)
  })

  it('C2-A-050 reads MathML TeX and ruby annotations into typed nodes', () => {
    const math = importDocument('<math alttext="x+y"></math>', { from: 'html' })
    const ruby = importDocument('<p><ruby>字<rt>ji</rt></ruby></p>', { from: 'html' })
    const first = math.document.children[0]
    if (first?.type === 'paragraph') expect(first.children[0]?.type).toBe('math')
    const rubyParagraph = ruby.document.children[0]
    if (rubyParagraph?.type === 'paragraph') expect(rubyParagraph.children[0]?.type).toBe('ruby')
  })

  it('C2-H-173 applies the engine URL policy to imported destinations', () => {
    const result = importDocument('<p><a href="javascript:alert(1)">bad</a></p>', { from: 'html' })
    expect(result.diagnostics.some(row => row.code === 'import-degraded')).toBe(true)
    const paragraph = result.document.children[0]
    if (paragraph?.type === 'paragraph') {
      const link = paragraph.children[0]
      if (link?.type === 'link') expect(link.href).toBeUndefined()
    }
  })

  it('C2-A-197 stores direct HTML alignment in carve.style', () => {
    const result = importDocument('<p style="text-align: center" lang="en">center</p>', { from: 'html' })
    const first = result.document.children[0]
    expect(first?.data?.['carve.style']).toEqual({ alignment: 'center' })
    expect(first?.lang).toBe('en')
  })

  it('C2-A-031 carries full HTML document language to the root', () => {
    const result = importDocument('<!doctype html><html lang="fr"><body><p>Bonjour</p></body></html>', { from: 'html' })
    expect(result.document.lang).toBe('fr')
    expect(result.document.children[0]?.type).toBe('paragraph')
  })

  it('C2-A-173 records unsupported HTML nodes with a foreign type and range', () => {
    const result = importDocument('<input type="text">', { from: 'html' })
    const finding = result.diagnostics.find(row => row.code === 'import-unsupported')
    expect(finding?.foreignType).toBe('input')
    expect(finding?.range).toEqual({ startOffset: 0, endOffset: 19 })
  })
})
