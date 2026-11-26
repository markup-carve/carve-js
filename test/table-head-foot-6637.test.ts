import { describe, expect, it } from 'vitest'
import { lint, parse, render, write, writeWithDiagnostics } from '../src/index.ts'
import { importDocument } from '../import/src/index.ts'

type Group = { type: string, children: { type: string, children?: { header?: boolean }[] }[] }

/** The groups of the first table, each with the header flag of the first cell of each row. */
function groups(source: string): string[] {
  const table = parse(source, { positions: false }).children[0] as unknown as { children: Group[] }
  return table.children.map((group) => `${group.type}:${group.children.filter((row) => row.type === 'table_row')
    .map((row) => (row.children![0]!.header === true ? 'th' : 'td')).join(',')}`)
}

describe('carve#6637: an empty body-rows ends the head above a footer of header rows (C2-B-187)', () => {
  it.each([
    ['{footer-rows=1 body-rows}\n|= A |\n|= F |\n', ['table_head:th', 'table_foot:th']],
    ['{footer-rows=2 body-rows}\n|= A |\n|= F |\n|= G |\n', ['table_head:th', 'table_foot:th,th']],
    ['{footer-rows=1 body-rows}\n|= A |\n|= B |\n|= F |\n', ['table_head:th,th', 'table_foot:th']],
    ['{footer-rows=2 body-rows}\n|= A |\n|= F |\n| G |\n', ['table_head:th', 'table_foot:th,td']],
    ['{body-rows="" footer-rows=1}\n|= A |\n|= F |\n', ['table_head:th', 'table_foot:th']],
    ['{footer-rows=1 body-rows}\n|= A |= B |\n|= ^ |= F |\n', ['table_head:th', 'table_foot:th']],
    // carve#6664: a count of all the rows leaves no head.
    ['{footer-rows=2 body-rows}\n|= A |\n|= F |\n', ['table_foot:th,th']],
  ])('%j', (source, expected) => {
    expect(groups(source)).toEqual(expected)
    expect(lint(source).map((entry) => entry.code)).not.toContain('table-row-count-clamped')
  })

  it.each([
    ['{footer-rows=1}\n|= A |\n|= F |\n', ['table_head:th,th']],
    ['{footer-rows=1 body-rows=0}\n|= A |\n|= F |\n', ['table_head:th,th', 'table_body:']],
    ['{footer-rows=1 body-rows body-header-rows=1}\n|= A |\n|= F |\n', ['table_head:th,th']],
    ['{footer-rows=1 body-rows}\n|= A |\n|= B |\n| F |\n', ['table_head:th,th', 'table_foot:td']],
  ])('keeps the head of C2-B-178 for %j', (source, expected) => {
    expect(groups(source)).toEqual(expected)
  })

  it('renders the footer cells as row headers', () => {
    expect(render('{footer-rows=1 body-rows}\n|= A |\n|= F |\n')).toBe(
      '<table>\n  <thead>\n    <tr><th scope="col">A</th></tr>\n  </thead>\n  <tfoot>\n    <tr><th scope="row">F</th></tr>\n  </tfoot>\n</table>',
    )
  })
})

describe('carve#6637: the writer and the HTML import spell a head and a header-cell foot with no body (C2-W-136)', () => {
  it.each([
    ['{footer-rows=1 body-rows}\n|= A |\n|= F |\n'],
    ['{footer-rows=2 body-rows}\n|= A |\n|= B |\n|= F |\n| G |\n'],
    ['{.t footer-rows=1 body-rows}\n|= A |= B |\n|= F |= G |\n^ Cap\n'],
    ['{footer-rows=1 body-rows}\n|= A |\n|= ^ |\n|= F |\n'],
  ])('writes %j and reads it back', (source) => {
    const tree = parse(source, { positions: false })
    const written = writeWithDiagnostics(tree)
    expect(written.source).toBe(source)
    expect(written.diagnostics).toEqual([])
  })

  it('writes no body-rows where the foot leads with a data row or a body stands between', () => {
    expect(write(parse('{footer-rows=1}\n|= A |\n| F |\n'))).toBe('{footer-rows=1}\n|= A |\n| F |\n')
    expect(write(parse('{footer-rows=1}\n|= A |\n| b |\n|= F |\n'))).toBe('{footer-rows=1}\n|= A |\n| b |\n|= F |\n')
  })

  it.each([
    '<table><thead><tr><th>A</th></tr><tr><th>B</th></tr></thead><tfoot><tr><th>F</th></tr><tr><td>G</td></tr></tfoot></table>',
    '<table><tr><th>A</th></tr><tfoot><tr><th>F</th></tr></tfoot></table>',
  ])('imports %s without a refusal', (html) => {
    const result = importDocument(html, { from: 'html' })
    expect(result.diagnostics).toEqual([])
    expect(render(result.source)).toContain('<tfoot>\n    <tr><th scope="row">F</th></tr>')
  })
})
