// C2-B-171 to C2-B-173: the cell prefix is no content, so a cell behind a header mark or a brace block that holds
// only `<` or `^` is a span mark too.
import { describe, expect, it } from 'vitest'
import { format, parse, render } from '../src/index.ts'

interface Cell {
  header: boolean
  colspan?: number
  rowspan?: number
  attrs?: unknown
  children: { children: unknown[] }[]
}

/** The cells of each row of the first table of `src`, in order. */
function rows(src: string): Cell[][] {
  const table = parse(src).children[0]
  if (table?.type !== 'table') throw new Error(`no table in ${JSON.stringify(src)}`)
  const cells: Cell[][] = []
  for (const part of table.children) {
    if (part.type === 'comment') continue
    for (const row of part.children) if (row.type === 'table_row') cells.push(row.children as unknown as Cell[])
  }
  return cells
}

describe('a span mark behind a cell prefix', () => {
  it('C2-B-172, C2-B-173: a failed mark behind a header mark is an empty header cell', () => {
    for (const src of ['|= ^|', '|= <|', '|=^|', '|= ^ |', '|={.x} ^|', '|={<} ^|']) {
      const [cell] = rows(src)[0]!
      expect(cell, src).toMatchObject({ header: true })
      expect(cell!.children[0]!.children, src).toEqual([])
      expect(render(src), src).not.toMatch(/[>]\^<|&lt;</u)
    }
  })

  it('C2-B-173: a failed mark behind a header mark in a row with a body cell is a body cell', () => {
    const [cell, other] = rows('|= <| a |')[0]!
    expect(cell).toMatchObject({ header: false })
    expect(cell!.children[0]!.children).toEqual([])
    expect(other).toMatchObject({ header: false })
  })

  it('C2-B-172: a mark behind a header mark joins the cell to its left or the cell above', () => {
    expect(rows('|= a |= <|')[0]).toMatchObject([{ header: true, colspan: 2 }, { span: 'colspan' }])
    expect(rows('|= a |\n|= ^|')).toMatchObject([[{ header: true, rowspan: 2 }], [{ span: 'rowspan' }]])
    expect(rows('| a | b |\n| c |= <|')[1]).toMatchObject([{ colspan: 2 }, { span: 'colspan' }])
  })

  it('C2-B-172: a mark behind a brace block joins the cell to its left or the cell above', () => {
    expect(rows('| a |{.x} <|')[0]).toMatchObject([{ colspan: 2 }, { span: 'colspan' }])
    expect(rows('| a | b |\n|{.x} ^| c |')).toMatchObject([[{ rowspan: 2 }, {}], [{ span: 'rowspan' }, {}]])
  })

  it('C2-B-178: a row of header marks whose last cell spans is a head row', () => {
    expect(render('|= a |= <|\n| b | c |')).toContain('<thead>')
  })

  it('C2-W-063: a header cell whose content is a span mark of text keeps its escape', () => {
    for (const src of ['|= \\^ |\n', '|= \\< |\n', '|{.x} \\^ |\n']) {
      expect(format(src), src).toBe(src)
      expect(rows(src)[0]![0]!.children[0]!.children, src).toMatchObject([{ type: 'text' }])
    }
  })
})
