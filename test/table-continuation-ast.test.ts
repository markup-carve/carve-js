import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, parse } from '../src/index.js'

describe('table continuation AST', () => {
  it('keeps a wrap inside a span shared across lines', () => {
    const source = '| *bold | x |\n+ text* | y |\n'
    const table = parse(source).children[0]
    expect(table?.type).toBe('table')
    if (table?.type !== 'table') return
    expect(table.rows[0]?.continuationLines).toBe(1)
    expect(table.rows[0]?.cells[0]?.children).toMatchObject([
      { type: 'strong', children: [{ type: 'text', value: 'bold' }, { type: 'cell_wrap', line: 1 }, { type: 'text', value: 'text' }] },
    ])
    const strong = table.rows[0]?.cells[0]?.children?.[0]
    expect(strong?.type === 'strong' ? strong.children[1]?.pos : undefined).toEqual({
      startLine: 2, endLine: 2, startColumn: 1, endColumn: 2,
      startOffset: source.indexOf('+'), endOffset: source.indexOf('+') + 1,
    })
    expect(carveToCarve(source)).toBe(source)
    expect(carveToHtml(source)).toContain('<strong>bold text</strong>')
  })

  it('gives a part a colspan marker joins its column', () => {
    const source = '| a | < |\n+ x | y |\n'
    const table = parse(source).children[0]
    expect(table?.type).toBe('table')
    if (table?.type !== 'table') return
    expect(table.rows[0]?.cells[0]?.children).toMatchObject([
      { type: 'text', value: 'a' }, { type: 'cell_wrap', line: 1 }, { type: 'text', value: 'x' },
      { type: 'cell_wrap', line: 1, col: 1 }, { type: 'text', value: 'y' },
    ])
    expect(carveToCarve(source)).toBe(source)
    expect(carveToHtml(source)).toContain('<td colspan="2">a x y</td>')
  })

  it('gives each part of a rowspan strip its row and column', () => {
    const source = '| a | < |\n| ^ | ^ |\n+ x | y |\n'
    const table = parse(source).children[0]
    expect(table?.type === 'table' && table.rows[0]?.cells[0]?.children).toMatchObject([
      { type: 'text', value: 'a' }, { type: 'cell_wrap', line: 1, row: 1 }, { type: 'text', value: 'x' },
      { type: 'cell_wrap', line: 1, row: 1, col: 1 }, { type: 'text', value: 'y' },
    ])
    expect(carveToCarve(source)).toBe(source)
  })

  it('counts an empty continuation line', () => {
    const source = '| a | b |\n+ | |\n'
    const table = parse(source).children[0]
    expect(table?.type === 'table' && table.rows[0]?.continuationLines).toBe(1)
    expect(carveToCarve(source)).toBe(source)
  })

  it('marks a join into the cell above a rowspan', () => {
    const source = '| a | b |\n| ^ | c |\n+ more | d |\n'
    const table = parse(source).children[0]
    expect(table?.type).toBe('table')
    if (table?.type !== 'table') return
    expect(table.rows[1]?.continuationLines).toBe(1)
    expect(table.rows[0]?.pos).toBeUndefined()
    expect(table.rows[1]?.pos).toBeUndefined()
    expect(table.rows[0]?.cells[0]?.children).toMatchObject([
      { type: 'text', value: 'a' }, { type: 'cell_wrap', line: 1, row: 1 }, { type: 'text', value: 'more' },
    ])
    expect(table.rows[0]?.cells[0]?.children?.[1]?.pos).toEqual({
      startLine: 3, endLine: 3, startColumn: 1, endColumn: 2,
      startOffset: source.indexOf('+'), endOffset: source.indexOf('+') + 1,
    })
    expect(carveToCarve(source)).toBe(source)
  })

  it('keeps both continuation fragments when a colspan marker joins left', () => {
    const source = '| a | < |\n+ x | y |\n'
    const table = parse(source).children[0]
    expect(table?.type === 'table' && table.rows[0]?.pos).toBeDefined()
    expect(carveToCarve(source)).toBe(source)
    expect(carveToHtml(source)).toContain('a x y')
  })

  it('keeps atomic code span text free of an internal marker character', () => {
    const source = '| `alpha | x |\n+ beta` | y |\n'
    expect(carveToHtml(source)).not.toContain('\uE000')
    expect(carveToCarve(source)).not.toContain('\uE000')
  })

  it('keeps whitespace-sensitive inline parsing across the join', () => {
    expect(carveToHtml('| a * |\n+ b* | x |\n')).toContain('<td>a * b*</td>')
    expect(carveToHtml('| a \\ |\n+ b | x |\n')).toContain('<td>a &nbsp;b</td>')
    expect(carveToHtml('| a -- |\n+ b |\n')).toContain('<td>a – b</td>')
    expect(carveToHtml('| a | b |\n+ "b" | y |\n')).toContain('<td>a “b”</td>')
    expect(carveToHtml('| a | b |\n+ {.c}x | y |\n')).toContain('<td>a {.c}x</td>')
  })

  it('keeps a header continuation before its separator', () => {
    const source = '| a | b |\n+ x | y |\n|---|---|\n| e | f |\n'
    expect(carveToCarve(source)).toBe(source)
  })
})
