import { describe, expect, it } from 'vitest'
import { lintCarve, parse } from '../src/index.js'

describe('inline positions after escaped table pipes', () => {
  it.each([
    ['| [a\\|b][m] |\n', 2, 11],
    ['| ![a\\|b][m] |\n', 2, 12],
    ['| [a\\|b\\|c][m] |\n', 2, 14],
  ])('places an unresolved reference in %j', (source, startOffset, endOffset) => {
    const table = parse(source).children[0]
    expect(table?.type).toBe('table')
    if (table?.type !== 'table') return
    expect(table.rows[0]?.cells[0]?.children?.[0]?.pos).toMatchObject({
      startLine: 1, startColumn: 3, startOffset, endOffset,
    })
    expect(lintCarve(source).filter(warning => warning.rule === 'unresolved-reference-link')
      .map(warning => [warning.line, warning.column])).toEqual([[1, 3]])
  })

  it.each([
    ['| [a][missing] |\n+ b\\|c |\n', [[1, 3]]],
    ['| a\\|b |\n+ [c][missing] |\n', [[2, 3]]],
    ['| [a\\|b][missing] |\n+ [c][missing] |\n', [[1, 3], [2, 3]]],
  ])('keeps positions in separate continuation fragments: %j', (source, positions) => {
    expect(lintCarve(source).filter(warning => warning.rule === 'unresolved-reference-link')
      .map(warning => [warning.line, warning.column])).toEqual(positions)
  })
})
