import { describe, expect, it } from 'vitest'
import {
  applyProfile, AstJsonSchemaError, diffAst, fromAstJson, Profile, renderAnsi, renderCarveWithReport,
  renderHtml, renderMarkdown, renderPlainText, resolve, toAstJson,
} from '../src/index.js'

const payload = () => ({
  type: 'document',
  srcByteLength: 0,
  children: [{
    type: 'section', level: 2, attrs: { id: 's' }, children: [
      { type: 'heading', level: 2, children: [{ type: 'text', value: 'Title' }] },
      { type: 'table', rows: [{ type: 'table_row', cells: [{
        type: 'table_cell', header: false, blocks: [
          { type: 'paragraph', children: [{ type: 'text', value: 'First' }] },
          { type: 'paragraph', children: [{ type: 'text', value: 'Second' }] },
        ],
      }] }] },
    ],
  }],
})

describe('interchange sections and block-content cells', () => {
  it('preserves both shapes through AST JSON', () => {
    const tree = payload()
    expect(toAstJson(fromAstJson(tree as never))).toEqual(tree)
    const changed = payload()
    changed.children[0].children[1].rows[0].cells[0].blocks[1].children[0].value = 'Third'
    expect(diffAst(tree as never, changed as never).some((change) => JSON.stringify(change).includes('blocks'))).toBe(true)
  })

  it('renders nested structure on HTML and keeps its content on other targets', () => {
    const doc = fromAstJson(payload() as never)
    const html = renderHtml(doc)
    expect(html).toContain('<section id="s">')
    expect(html).toContain('<td><p>First</p>\n<p>Second</p></td>')
    expect(html).toContain('</section>')
    expect(renderMarkdown(doc)).toContain('First<br>Second')
    expect(renderPlainText(doc)).toContain('First Second')
    expect(renderAnsi(doc)).toContain('First Second')
  })

  it('reports source structures Carve cannot spell', () => {
    const report = renderCarveWithReport(fromAstJson(payload() as never))
    expect(report.value).toContain('First Second')
    expect(report.losses.map((loss) => loss.code)).toEqual(['section-flattened', 'table-cell-blocks-flattened'])
  })

  it('lets profiles deny sections and visit blocks inside cells', () => {
    const doc = fromAstJson(payload() as never)
    expect(() => applyProfile(structuredClone(doc), Profile.full().denyBlock(['section']).onDisallowed('error'))).toThrow(/section/)
    expect(() => applyProfile(structuredClone(doc), Profile.full().denyBlock(['paragraph']).onDisallowed('error'))).toThrow(/paragraph/)
  })

  it('resolves headings and references inside block cells', () => {
    const doc = fromAstJson({
      type: 'document', srcByteLength: 0, children: [
        { type: 'table', rows: [{ type: 'table_row', cells: [{
          type: 'table_cell', header: false, blocks: [
            { type: 'heading', level: 2, children: [{ type: 'text', value: 'Cell heading' }] },
            { type: 'paragraph', children: [{ type: 'heading_ref', target: 'cell-heading' }] },
          ],
        }] }] },
      ],
    } as never)
    const html = renderHtml(resolve(doc))
    expect(html).toContain('id="Cell-heading"')
    expect(html).toContain('href="#Cell-heading"')
  })

  it('escapes raw HTML when Markdown flattens block cells', () => {
    const doc = fromAstJson({
      type: 'document', srcByteLength: 0, children: [{
        type: 'table', rows: [{ type: 'table_row', cells: [{
          type: 'table_cell', header: false, blocks: [
            { type: 'raw_block', format: 'html', content: '<script>alert(1)</script>' },
          ],
        }] }],
      }],
    } as never)
    expect(renderMarkdown(doc)).toContain('&lt;script&gt;')
  })

  it('keeps inline references when flattening block cells', () => {
    const doc = {
      type: 'document', children: [{ type: 'table', rows: [{ type: 'table_row', cells: [{
        type: 'table_cell', header: false, blocks: [{ type: 'paragraph', children: [
          { type: 'text', value: 'See ' }, { type: 'footnote_ref', id: 'm' },
        ] }],
      }] }] }],
      footnoteDefs: { m: [{ type: 'paragraph', children: [{ type: 'text', value: 'Note' }] }] },
    } as never
    expect(renderMarkdown(doc)).toContain('| See [^m] |')
    expect(renderCarveWithReport(doc).value).toContain('| See [^m] |')
  })

  it.each([
    { children: [], blocks: [] },
    {},
    { blocks: 'text' },
  ])('rejects a cell without exactly one content array: %j', (content) => {
    const tree = payload() as Record<string, any>
    Object.assign(tree.children[0].children[1].rows[0].cells[0], content)
    if (!('blocks' in content)) delete tree.children[0].children[1].rows[0].cells[0].blocks
    expect(() => fromAstJson(tree as never)).toThrow(AstJsonSchemaError)
  })

  it.each([0, 7, 1.5])('rejects section level %s', (level) => {
    const tree = payload()
    tree.children[0].level = level
    expect(() => fromAstJson(tree as never)).toThrow(AstJsonSchemaError)
  })

  it('bounds deeply nested sections at ingest and render', () => {
    let nested: Record<string, unknown> = { type: 'paragraph', children: [] }
    for (let i = 0; i < 1000; i++) nested = { type: 'section', children: [nested] }
    const tree = { type: 'document', srcByteLength: 0, children: [nested] }
    expect(() => fromAstJson(tree as never)).toThrow()
    expect(() => renderHtml({ type: 'document', children: [nested] } as never)).toThrow()
  })
})
