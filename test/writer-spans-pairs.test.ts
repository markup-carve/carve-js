import { describe, expect, it } from 'vitest'
import { format, lint, parse, render, treesEqual, writeWithDiagnostics } from '../src/index.ts'
import { importDocument } from '../public/index.ts'
import { type DocumentNode, type TableBodyNode, type TableCellNode, type TableNode, type TableRowNode } from '../src/ast.ts'
import { documentOf } from './support/tree.ts'

const PAIR_RULES = ['deprecated-bare-underline', 'deprecated-bare-strike', 'deprecated-bare-highlight',
  'markdown-strikethrough-double-tilde', 'markdown-strong-double-star']

function imported(html: string): { source: string, codes: string[] } {
  const result = importDocument(html, { from: 'html' })
  return { source: result.source, codes: result.diagnostics.map((entry) => `${entry.code} ${entry.path ?? ''}`) }
}

describe('C2-W-145: a span count that no mark cell covers is written with span marks', () => {
  it('writes a colspan in a body row, in the head and to the end of the row', () => {
    expect(imported('<table><tr><th>A</th><th>B</th></tr><tr><td colspan="2">m</td></tr></table>'))
      .toEqual({ source: '{body-rows=1 body-header-rows=1}\n| A | B |\n| m | < |\n', codes: [] })
    expect(imported('<table><thead><tr><th colspan="2">H</th></tr></thead><tbody><tr><td>a</td><td>b</td></tr></tbody></table>'))
      .toEqual({ source: '|= H |= < |\n| a | b |\n', codes: [] })
    expect(imported('<table><tr><td>a</td><td colspan="3">b</td></tr></table>'))
      .toEqual({ source: '| a | b | < | < |\n', codes: [] })
  })

  it('writes a rowspan at its column in each row below, also beside another one', () => {
    expect(imported('<table><tr><td rowspan="2">a</td><td>b</td></tr><tr><td>c</td></tr></table>').source)
      .toBe('| a | b |\n| ^ | c |\n')
    expect(imported('<table><tr><td>x</td><td rowspan="2">a</td></tr><tr><td>c</td></tr></table>').source)
      .toBe('| x | a |\n| c | ^ |\n')
    expect(imported('<table><tr><td rowspan="3">a</td><td>b</td><td rowspan="2">c</td></tr><tr><td>d</td></tr>' +
      '<tr><td>e</td><td>f</td></tr></table>').source).toBe('| a | b | c |\n| ^ | d | ^ |\n| ^ | e | f |\n')
  })

  it('writes the colspan of a cell with both counts and reports its rowspan', () => {
    expect(imported('<table><tr><td rowspan="2" colspan="2">a</td><td>b</td></tr><tr><td>c</td></tr>' +
      '<tr><td>1</td><td>2</td><td>3</td></tr></table>')).toEqual({
      source: '| a | < | b |\n| c |\n| 1 | 2 | 3 |\n',
      codes: ['field-unspellable /children/0/children/0/children/0/children/0/rowspan'],
    })
  })

  it('reads back as the supplied tree with the marks added, renders the same grid and leaves the tree as it was', () => {
    const cell = (value: string, extra: Partial<TableCellNode> = {}): TableCellNode =>
      ({ type: 'table_cell', header: false, children: [{ type: 'cell_paragraph', children: [{ type: 'text', value }] }], ...extra })
    const tree = documentOf({ type: 'table', columns: [{ type: 'table_column' }, { type: 'table_column' }], children: [
      { type: 'table_body', children: [
        { type: 'table_row', children: [cell('m', { colspan: 2 })] },
        { type: 'table_row', children: [cell('a', { rowspan: 2 }), cell('b')] },
        { type: 'table_row', children: [cell('c')] },
      ] },
    ] })
    const before = JSON.stringify(tree)
    const { source, diagnostics } = writeWithDiagnostics(tree)
    expect(source).toBe('| m | < |\n| a | b |\n| ^ | c |\n')
    expect(diagnostics).toEqual([])
    expect(JSON.stringify(tree)).toBe(before)
    expect(render(source)).toBe(render(parse(source)))
    expect(render(source)).toContain('<td colspan="2">m</td>')
    expect(render(source)).toContain('<td rowspan="2">a</td>')
  })
})

describe('C2-W-145: in a table that already holds marks, only the counts without marks take them', () => {
  const plain = (source: string): DocumentNode => JSON.parse(JSON.stringify(parse(source), (key, value: unknown) =>
    (key === 'pos' ? undefined : value))) as DocumentNode
  const rowsOf = (tree: DocumentNode): TableRowNode[] => ((tree.children[0] as TableNode).children[0] as TableBodyNode)
    .children as TableRowNode[]

  it('adds the < of a colspan below a row whose span is marked', () => {
    const tree = plain('| a | < | b |\n| c | d | e |\n')
    const row = rowsOf(tree)[1]!
    row.children = [{ ...row.children[0]!, colspan: 2 }, row.children[2]!]
    expect(writeWithDiagnostics(tree)).toEqual({ source: '| a | < | b |\n| c | < | e |\n', diagnostics: [] })
  })

  it('adds the ^ of a rowspan below rows whose row span is marked', () => {
    const tree = plain('| a | b |\n| ^ | c |\n| d | e |\n| f |\n')
    const row = rowsOf(tree)[2]!
    row.children = [row.children[0]!, { ...row.children[1]!, rowspan: 2 }]
    expect(writeWithDiagnostics(tree)).toEqual({ source: '| a | b |\n| ^ | c |\n| d | e |\n| f | ^ |\n', diagnostics: [] })
  })
})

describe('C2-W-146: canonical output passes the pair rules of lint', () => {
  const cases: [string, string][] = [
    ['~s~', '\\~s~\n'], ['_u_', '\\_u_\n'], ['=x=', '\\=x=\n'], ['~~s~~', '\\~\\~s~~\n'], ['**b**', '\\*\\*b**\n'],
    ['a _u_ and =x= b', 'a \\_u_ and \\=x= b\n'], ['a_b_c', 'a_b_c\n'], ['x ~\u0301a~ y', 'x ~\u0301a~ y\n'],
  ]
  it.each(cases)('writes the text %j as %j, which reads back and lints clean', (value, expected) => {
    const tree = documentOf({ type: 'paragraph', children: [{ type: 'text', value }] })
    const { source, diagnostics } = writeWithDiagnostics(tree)
    expect(source).toBe(expected)
    expect(diagnostics).toEqual([])
    expect(treesEqual(parse(source), tree)).toBe(true)
    expect(lint(source, { upgrade: true }).filter((entry) => PAIR_RULES.includes(entry.code))).toEqual([])
    expect(format(source)).toBe(source)
  })

  it('keeps an author escape of a pair in fmt', () => {
    expect(format('\\_u_ \\*\\*b**\n')).toBe('\\_u_ \\*\\*b**\n')
    expect(format('x _y_\n')).toBe('x \\_y_\n')
  })
})
