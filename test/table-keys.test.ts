// R9 of the 0.2 rulings: the four table keys are consumed when valid and kept in attrs when not (C2-B-227).
import { describe, expect, it } from 'vitest'
import { type DocumentNode, format, lint, parse, render, type TableNode, writeWithDiagnostics } from '../src/index.ts'

function table(src: string): TableNode {
  const node = parse(src, { positions: false }).children[0]
  if (node?.type !== 'table') throw new Error('no table')
  return node
}

const cell = (value: string): TableNode['children'][number] => ({
  type: 'table_body', children: [{ type: 'table_row', children: [{
    type: 'table_cell', header: false, children: [{ type: 'cell_paragraph', children: [{ type: 'text', value }] }],
  }] }],
})

describe('table keys', () => {
  it('C2-B-211, C2-B-212, C2-B-220: a column list is checked whole, and an invalid one sets no column and stays', () => {
    const node = table('{aligns=right,x widths=25,x}\n| a | b |\n')
    expect(node.columns).toEqual([{ type: 'table_column' }, { type: 'table_column' }])
    expect(node.attrs).toEqual({ keyValues: [['aligns', 'right,x'], ['widths', '25,x']] })
    expect(render('{aligns=right,x widths=25,x}\n| a | b |\n')).toBe('<table>\n  <tbody>\n    <tr><td>a</td><td>b</td></tr>\n  </tbody>\n</table>')
  })

  it('C2-B-211: an empty entry anywhere, also past the last column, invalidates the list; a short valid list applies', () => {
    expect(table('{aligns=right,,left}\n| a | b | c |\n').columns.map((column) => column.align)).toEqual([undefined, undefined, undefined])
    expect(table('{aligns=right,left,}\n| a | b |\n').columns.map((column) => column.align)).toEqual([undefined, undefined])
    const short = table('{aligns=right}\n| a | b |\n')
    expect(short.columns.map((column) => column.align)).toEqual(['right', undefined])
    expect(short.attrs).toBeUndefined()
  })

  it('C2-B-220: .5, 5., 1e1 and +5 are no widths', () => {
    for (const entry of ['.5', '5.', '1e1', '+5', '0', '101']) {
      expect(table(`{widths=${entry}}\n| a |\n`).attrs?.keyValues, entry).toEqual([['widths', entry]])
    }
    expect(table('{widths=30.5}\n| a |\n').columns[0]?.width).toBe(0.305)
  })

  it('C2-B-227, C2-W-136, C2-H-153: an invalid value stays in attrs, is written back and is no HTML attribute', () => {
    expect(table('{widths=x .t}\n| a |\n').attrs).toEqual({ classes: ['t'], keyValues: [['widths', 'x']] })
    expect(format('{widths=x .t}\n| a |\n')).toBe('{.t widths=x}\n| a |\n')
    expect(render('{widths=x .t}\n| a |\n')).toBe('<table class="t">\n  <tbody>\n    <tr><td>a</td></tr>\n  </tbody>\n</table>')
    expect(render('{aligns=x}\npara\n')).toBe('<p aligns="x">para</p>')
  })

  it('C2-B-210, C2-B-186, C2-B-227: counts are consumed when valid; header-rows on a pipe table stays', () => {
    const node = table('{header-rows=2 footer-rows=x}\n| a | b |\n| c | d |\n')
    expect(node.attrs).toEqual({ keyValues: [['header-rows', '2'], ['footer-rows', 'x']] })
    expect(node.children.map((group) => group.type)).toEqual(['table_body'])
    expect(format('{header-rows=2 footer-rows=x}\n| a | b |\n| c | d |\n')).toBe('{header-rows=2 footer-rows=x}\n| a | b |\n| c | d |\n')
    const csv = table('{table header-rows=0}\n```csv\na\n```\n')
    expect(csv.attrs).toBeUndefined()
    expect(csv.children[0]).toEqual(expect.objectContaining({ type: 'table_body' }))
    expect(csv.children[0]).not.toHaveProperty('headRows')
    expect(table('{footer-rows=1}\n| a |\n| b |\n').attrs).toBeUndefined()
  })

  it('C2-B-227: lint reports a kept invalid value as table-attribute-invalid', () => {
    const codes = (src: string): string[] => lint(src, { upgrade: true }).map((entry) => entry.code).filter((code) => code.startsWith('table') || code.startsWith('dep'))
    expect(codes('{widths=x .t}\n| a |\n')).toEqual(['table-attribute-invalid'])
    expect(lint('{widths=x .t}\n| a |\n')[0]?.message)
      .toBe('The value of widths is not valid, so the table ignores the whole attribute. Correct every entry, or remove the attribute.')
    expect(codes('{aligns=right,x widths=25,x}\n| a | b |\n')).toEqual(['table-attribute-invalid', 'table-attribute-invalid'])
    expect(codes('{header-rows=2 footer-rows=x}\n| a | b |\n| c | d |\n')).toEqual(['deprecated-table-attribute', 'table-attribute-invalid'])
  })

  it('C2-W-136: a key is written once, from the fields where attrs holds it too, and the key in attrs is reported', () => {
    const document: DocumentNode = { type: 'document', astVersion: '2.0', children: [{
      type: 'table', columns: [{ type: 'table_column', align: 'left' }], attrs: { keyValues: [['aligns', 'x']] },
      children: [cell('a')],
    }] }
    const output = writeWithDiagnostics(document)
    expect(output.source).toBe('{aligns=left}\n| a |\n')
    expect(output.diagnostics.map((entry) => [entry.code, entry.path])).toEqual([['field-unspellable', '/children/0/attrs/keyValues/0']])
    const fromAttrs: DocumentNode = { type: 'document', astVersion: '2.0', children: [{
      type: 'table', columns: [{ type: 'table_column' }], attrs: { keyValues: [['aligns', 'x']] }, children: [cell('a')],
    }] }
    expect(writeWithDiagnostics(fromAttrs).source).toBe('{aligns=x}\n| a |\n')
  })

  it('C2-B-211, C2-B-212: the example of the specification', () => {
    expect(render('{aligns=right,x widths=25,,25 footer-rows=two .t}\n| a | b |\n| c | d |\n'))
      .toBe('<table class="t">\n  <tbody>\n    <tr><td>a</td><td>b</td></tr>\n    <tr><td>c</td><td>d</td></tr>\n  </tbody>\n</table>')
  })
})
