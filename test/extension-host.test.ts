import { describe, expect, it } from 'vitest'
import { render, type ExtensionRenderer } from '../src/index.ts'
import { listTableExtension, listTableRenderer } from '../extensions/blocks/list-table.ts'

describe('trusted extension render host', () => {
  it('provides the sourceLines setting and writes a generated block attribute last', () => {
    const renderer: ExtensionRenderer = { version: '1', render(node, host) {
      expect(host.sourceLines).toBe(true)
      const row = node.slots?.['rows']?.[0]
      return `<table${host.attributes(row ?? null, { block: true, bare: true })}></table>`
    } }
    const html = render('::: list-table\n- - A\n  - B\n:::', {
      sourceLines: true, extensions: [listTableExtension], renderers: { 'carve.listTable': renderer },
    })
    expect(html).toBe('<table data-source-line="2"></table>')
  })

  it('provides the block depth for every continuation line', () => {
    const renderer: ExtensionRenderer = { version: '1', render(_node, host) {
      const indent = '  '.repeat(host.blockDepth)
      return `<table>\n${indent}  <tbody>\n${indent}  </tbody>\n${indent}</table>`
    } }
    const html = render('::: wrap\n\n::: list-table\n- - A\n  - B\n:::\n\n:::', {
      extensions: [listTableExtension], renderers: { 'carve.listTable': renderer },
    })
    expect(html).toBe('<div class="wrap">\n  <table>\n    <tbody>\n    </tbody>\n  </table>\n</div>')
  })

  it('lets list table annotate the table, row group and row', () => {
    const html = render('::: list-table\n- - A\n  - B\n:::', {
      sourceLines: true, extensions: [listTableExtension], renderers: { 'carve.listTable': listTableRenderer },
    })
    expect(html).toContain('<table data-source-line="1">')
    expect(html).toContain('<tbody data-source-line="2">')
    expect(html).toContain('<tr data-source-line="2">')
    const authored = render('{data-source-line=99 .x}\n::: list-table\n- - A\n  - B\n:::', {
      sourceLines: true, extensions: [listTableExtension], renderers: { 'carve.listTable': listTableRenderer },
    })
    expect(authored).toContain('<table class="x" data-source-line="1">')
    expect(authored).not.toContain('data-source-line="99"')
  })

  it('lets list table indent all lines inside a wrapper', () => {
    const html = render('::: wrap\n\n::: list-table [inner]\n- - A\n  - B\n:::\n\n:::', {
      extensions: [listTableExtension], renderers: { 'carve.listTable': listTableRenderer },
    })
    expect(html).toBe('<div class="wrap">\n  <p class="div-label">inner</p>\n  <table>\n    <tbody>\n' +
      '      <tr><td>A</td><td>B</td></tr>\n    </tbody>\n  </table>\n</div>')
  })
})
