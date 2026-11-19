// Freeze candidate 5, revision 1: vertical alignment of table cells, the header mark rule, and the engine entries
// of the fifth fix round (TODO_spec26, TODO_valign, TODO_spec27).
import { describe, expect, it } from 'vitest'
import { lint } from '../lint/lint.ts'
import {
  decodeTree, format, formatWithDiagnostics, parse, parseTree, parseWithLayout, render, tabsExtensions, validateLayout,
  write, writeWithDiagnostics, type DocumentNode, type TableCellNode, type TableNode,
} from '../src/index.ts'

function table(src: string): TableNode {
  const node = parse(src, { positions: false }).children[0]
  if (node?.type !== 'table') throw new Error(`no table in ${JSON.stringify(src)}`)
  return node
}

function cells(src: string): TableCellNode[] {
  const out: TableCellNode[] = []
  for (const group of table(src).children) {
    if (group.type === 'comment') continue
    for (const row of group.children) if (row.type === 'table_row') out.push(...row.children)
  }
  return out
}

function text(cell: TableCellNode | undefined): string {
  const paragraph = cell?.children[0]
  if (paragraph?.type !== 'cell_paragraph') return ''
  return paragraph.children.map((node) => ('value' in node ? node.value : '')).join('')
}

function codes(src: string): string[] {
  return lint(src).map((entry) => entry.code)
}

describe('C2-B-182: the vertical marks of a cell prefix', () => {
  it('C2-B-182: a vertical mark follows a horizontal mark or `?`', () => {
    const [qty, note] = cells('|={>^} Qty |={?v} Note |')
    expect(qty).toMatchObject({ header: true, align: 'right', valign: 'top' })
    expect(note).toMatchObject({ header: true, valign: 'bottom' })
    expect(note!.align).toBeUndefined()
    expect(cells('|{~~ .c} a |')[0]).toMatchObject({ align: 'center', valign: 'middle', attrs: { classes: ['c'] } })
    expect(cells('|{>v} a |')[0]).toMatchObject({ align: 'right', valign: 'bottom' })
  })

  it('C2-B-182: the character after the horizontal mark is the vertical mark, so `{>vx}` holds the bare key `x` (CC-084)', () => {
    const [cell] = cells('|{>vx} b |')
    expect(cell).toMatchObject({ align: 'right', valign: 'bottom', attrs: { keyValues: [['x', '']] } })
  })

  it('C2-B-182: a vertical mark alone, a `?` alone and a second vertical mark are no marks (CC-083, Example 274)', () => {
    const [caret, v, double] = cells('|{^} a |{v} b |{>^^} c |')
    expect(text(caret)).toBe('{^} a')
    expect(caret!.valign).toBeUndefined()
    expect(v).toMatchObject({ attrs: { keyValues: [['v', '']] } })
    expect(v!.valign).toBeUndefined()
    expect(text(double)).toBe('{>^^} c')
    expect(text(cells('|{?} a |')[0])).toBe('{?} a')
  })

  it('C2-B-185: a continuation row reads no vertical mark (CC-086)', () => {
    expect(text(cells('| a |\n+{<v} b |')[0])).toBe('a {<v} b')
  })
})

describe('C2-B-171: the header mark', () => {
  it('C2-B-171: `=` glued to a letter, a digit or `=` is cell text (CC-087, CC-091, CC-094)', () => {
    for (const [src, value] of [['|=a|', '=a'], ['|==a|', '==a'], ['|=SUM(A1)|', '=SUM(A1)'], ['|=^|', '=^']]) {
      const [cell] = cells(`${src!}\n| x |`)
      expect(cell, src).toMatchObject({ header: false })
      expect(text(cell), src).toBe(value)
    }
    expect(table('|=a|\n| x |').children.map((group) => group.type)).toEqual(['table_body'])
  })

  it('C2-B-171: before a space, a tab, `{`, an alignment mark or the cell end it is the header mark (CC-088 to CC-090)', () => {
    for (const [src, value] of [['|= a|', 'a'], ['|=\ta|', 'a'], ['|=|', ''], ['|=<a|', '<a'], ['|=~a|', '~a'],
      ['|=?v a|', '?v a'], ['|={.c}a|', 'a'], ['|={}a|', '{}a']]) {
      const [cell] = cells(src!)
      expect(cell, src).toMatchObject({ header: true })
      expect(text(cell), src).toBe(value)
    }
    expect(cells('|= H |=<|')[0]).toMatchObject({ header: true, colspan: 2 })
  })

  it('C2-B-171: Example 275 keeps the equals signs of the data cells', () => {
    expect(render('|= Item |=|=<x|\n| tea |=SUM(A1:A3)|==2|')).toContain('<td>=SUM(A1:A3)</td><td>==2</td>')
  })
})

describe('C2-B-211, C2-B-213, C2-A-089: `valigns` and the resolved vertical alignment', () => {
  it('C2-B-211: a valid `valigns` sets `table_column.valign` and leaves `attrs` (Example 273)', () => {
    const node = table('{valigns="top,bottom" aligns="left,right"}\n|= A |={?^} B |\n| a | b |')
    expect(node.attrs).toBeUndefined()
    expect(node.columns).toEqual([
      { type: 'table_column', align: 'left', valign: 'top', resolvedAlign: 'left', resolvedValign: 'top' },
      { type: 'table_column', align: 'right', valign: 'bottom', resolvedAlign: 'right', resolvedValign: 'top' },
    ])
  })

  it('C2-B-211, C2-B-227: an invalid entry makes the whole value invalid; it stays in `attrs` (CC-085)', () => {
    const node = table('{valigns="top,center"}\n| a | b |')
    expect(node.columns.every((column) => column.valign === undefined)).toBe(true)
    expect(node.attrs?.keyValues).toEqual([['valigns', 'top,center']])
    expect(codes('{valigns="top,center"}\n| a | b |')).toContain('table-attribute-invalid')
  })

  it('C2-B-211: `valigns` on a delimited table', () => {
    const node = table('{table valigns="bottom,top"}\n```csv\na,b\n1,2\n```')
    expect(node.columns.map((column) => column.valign)).toEqual(['bottom', 'top'])
  })

  it('C2-A-089, C2-B-213: `resolvedValign` is the vertical head mark, else the column `valign` (Example 272)', () => {
    const node = table('|={>^} Qty |={?v} Note |\n| 1 |{<~} a |')
    expect(node.columns).toEqual([
      { type: 'table_column', resolvedAlign: 'right', resolvedValign: 'top' },
      { type: 'table_column', resolvedValign: 'bottom' },
    ])
  })
})

describe('C2-H-057, C2-H-153: the HTML of vertical alignment', () => {
  it('C2-H-057: both axes in one style, the vertical one alone, after an authored style (Examples 272, 71)', () => {
    const html = render('|={>^} Qty |={?v} Note |\n| 1 | b |')
    expect(html).toContain('<th scope="col" style="text-align: right; vertical-align: top;">Qty</th>')
    expect(html).toContain('<td style="vertical-align: bottom;">b</td>')
    expect(render('{valigns="middle"}\n| a |\n|{?v style="color: red;"} b |'))
      .toContain('<td style="color: red; vertical-align: bottom;">b</td>')
  })

  it('C2-H-153: `valigns` is never an HTML attribute, valid or not', () => {
    expect(render('{valigns="top,bottom"}\n| a | b |')).toMatch(/^<table>/u)
    expect(render('{valigns="top,foo"}\n| a | b |')).toMatch(/^<table>/u)
  })
})

describe('C2-W-062, C2-W-136: the writer of vertical alignment', () => {
  it('C2-W-062: writer Example 16 is a fixed point', () => {
    const src = '|={>^} A |={?v} B |\n|{~~ .c} a | b |\n'
    expect(format(src)).toBe(src)
  })

  it('C2-W-062: `baseline` has no mark and is reported with `field-unspellable`', () => {
    const tree = parseTree('| a |', { positions: false }).document
    const node = tree.children[0] as TableNode
    const row = node.children[0]!
    if (row.type !== 'table_body' || row.children[0]?.type !== 'table_row') throw new Error('no row')
    row.children[0].children[0]!.valign = 'baseline'
    const out = writeWithDiagnostics(tree)
    expect(out.source).toBe('| a |\n')
    expect(out.diagnostics.map((entry) => entry.code)).toContain('field-unspellable')
  })

  it('C2-W-062: a data cell whose text starts with `=` needs no escape; an empty header cell is `|= |`', () => {
    expect(format('| =x |')).toBe('| =x |\n')
    expect(format('|=a|\n| x |')).toBe('| =a |\n| x |\n')
    expect(format('|=|')).toBe('|= |\n')
  })

  it('C2-W-136: `valigns` is written from the column fields, or once from `attrs`', () => {
    const tree = parseTree('| a | b |', { positions: false }).document
    const node = tree.children[0] as TableNode
    node.columns[1]!.valign = 'bottom'
    node.columns[0]!.valign = 'top'
    expect(write(tree)).toBe('{valigns=top,bottom}\n| a | b |\n')
    expect(format('{valigns="top,center"}\n| a | b |')).toBe('{valigns=top,center}\n| a | b |\n')
  })
})

describe('lint of vertical alignment', () => {
  it('C2-B-211: `table-column-arity` for a short `valigns`', () => {
    expect(codes('{valigns="top"}\n| a | b |')).toContain('table-column-arity')
  })

  it('C2-B-213: `table-column-overlap` per axis: Example 273 reports column 2 only', () => {
    const found = lint('{valigns="top,bottom" aligns="left,right"}\n|= A |={?^} B |\n| a | b |')
      .filter((entry) => entry.code === 'table-column-overlap')
    expect(found.map((entry) => entry.message)).toEqual([expect.stringContaining('Column 2 ')])
    expect(codes('{widths="50"}\n|={>} a |')).not.toContain('table-column-overlap')
  })

  it('C2-B-171, C2-W-106: `deprecated-cell-alignment` on a header cell and with a vertical mark', () => {
    for (const src of ['|=< a|', '|=?v a|', '|>^ a|', '|< a|']) expect(codes(src), src).toContain('deprecated-cell-alignment')
    expect(codes('|{<} a|')).not.toContain('deprecated-cell-alignment')
  })

  it('C2-B-171, C2-B-182: `deprecated-cell-alignment` on a run with a glued brace block, and no emphasis finding for it', () => {
    for (const src of ['|=~{.x} Mid |', '| <~{.x} a |', '|=?v{#i} a |']) expect(codes(src), src).toEqual(['deprecated-cell-alignment'])
    const [entry] = lint('|=~{.x} Mid |')
    expect(entry?.message).toContain('"~{.x}"')
    expect(entry?.message).toContain('write "{~ .x}"')
    expect(codes('| a ~{.x} b |')).toEqual(['emphasis-marker-before-attributes'])
    expect(codes('| ~{.x} a ~{.y} b |')).toEqual(['deprecated-cell-alignment', 'emphasis-marker-before-attributes'])
    expect(codes('| ~{.x}{.y} a |')).not.toContain('deprecated-cell-alignment')
  })
})

describe('the carve-js entries of the fifth fix round', () => {
  it('C2-A-102: a supplied math node with `numberPrefix` and no `number` is read (J1)', () => {
    const tree = { type: 'document', astVersion: '2.0', children: [{ type: 'paragraph', role: 'math',
      children: [{ type: 'math', display: true, value: 'x', numberPrefix: 'Eq' }] }] }
    expect(() => decodeTree(JSON.stringify(tree))).not.toThrow()
  })

  it('C2-N-016, C2-A-017: the expanded root declares the extensions of an included file once (J2)', () => {
    const files: Record<string, string> = { 'a.crv': ':::: tabs\n::: tab "A"\nx\n:::\n::::\n' }
    const options = { extensions: tabsExtensions, positions: false,
      includes: { resolver: (request: { path: string }) => ({ id: request.path, text: files[request.path]! }) } }
    const document: DocumentNode = parseTree('{{ a.crv }}\n\n{{ a.crv }}\n', options).document
    expect(document.extensions?.map((entry) => entry.name)).toEqual(['carve.tab', 'carve.tabs'])
    expect(() => decodeTree(JSON.stringify(document))).not.toThrow()
  })

  it('C2-H-168, C2-H-007, C2-H-040: in static mode a display math paragraph is written as in interactive mode (Example 69)', () => {
    const span = '<span class="math display" role="math">\\[x\\]</span>'
    expect(render('- $$`x`', { mode: 'static' }).trimEnd()).toBe(`<ul>\n  <li>${span}</li>\n</ul>`)
    for (const input of ['- $$`x`', '> $$`x`', ':: t\n: $$`x`']) expect(render(input, { mode: 'static' })).toBe(render(input))
  })

  it('C2-H-158, C2-H-093: the first top-level footnotes directive places the section, a later one nothing (J4, Example 68)', () => {
    const html = render('a[^n]\n\n::: footnotes\n:::\n\nb\n\n::: footnotes\n:::\n\n[^n]: x')
    expect(html.match(/<section/gu)).toHaveLength(1)
    expect(html).toContain('<div class="footnotes">')
  })

  it('C2-W-055, C2-W-024: a footnote that opens with a description list is written (J5)', () => {
    const src = '[^f]: :: t\n      : d\n'
    const out = formatWithDiagnostics(src)
    expect(out.source).toBe(src)
    expect(out.diagnostics).toEqual([])
  })

  it('C2-A-058, C2-X-037: an empty `resourceIds` is refused (J6)', () => {
    const tree = { type: 'document', astVersion: '2.0',
      extensions: [{ name: 'org.example.n', version: '1', required: false, slots: [] }],
      children: [{ type: 'block_extension', name: 'org.example.n', version: '1', children: [], resourceIds: [],
        fallback: [{ type: 'paragraph', children: [{ type: 'text', value: 'x' }] }] }] }
    expect(() => decodeTree(JSON.stringify(tree))).toThrow(/resourceIds/u)
  })

  it('C2-L-058, C2-L-006: `wraps` on a paragraph entry is read, and the writer ignores it (J7)', () => {
    const { document, layout } = parseWithLayout('a\nb\n')
    const record = structuredClone(layout)
    const entry = record.nodes.find((node) => node.path === '/children/0')!
    Object.assign(entry, { wraps: [{ line: 1, path: '/children/0/children/0', offset: 1 }] })
    expect(() => validateLayout(record)).not.toThrow()
    expect(write(document, { layout: record })).toBe('a\nb\n')
  })
})
