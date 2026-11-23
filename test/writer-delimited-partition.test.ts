import { describe, expect, it } from 'vitest'
import { formatWithDiagnostics, parse, write } from '../src/index.ts'

const FENCE = '```'
const table = (keys: string, rows: string[]): string => `{table ${keys}}\n${FENCE}csv\n${rows.join('\n')}\n${FENCE}\n`

// C2-W-066, C2-B-221, C2-B-230: `header-rows`, `body-rows`, `body-header-rows` and `footer-rows` partition a
// delimited table, so a partitioned table keeps the delimited form and the blanks at the ends of its cells.
describe('a delimited table with a partition stays delimited', () => {
  for (const [keys, rows] of [
    ['body-rows=1,1', ['h', 'a', ' b']],
    ['footer-rows=1', ['h', 'a', ' b']],
    ['body-rows=1 body-header-rows=1', ['h', 'a', ' b']],
    ['header-rows=0 body-rows=1,1', ['a', ' b']],
    ['body-rows=1,0', ['h', ' b']],
    ['body-rows=1,1', ['h', 'a', 'b']],
  ] as const) {
    it(keys, () => {
      const source = table(keys, [...rows])
      const { source: written, diagnostics } = formatWithDiagnostics(source)
      expect(written).toBe(source)
      expect(diagnostics.filter((entry) => entry.channel === 'render-loss')).toEqual([])
    })
  }

  it('writes the delimited form for a supplied tree whose cell starts with a space', () => {
    const tree = parse(table('body-rows=1,1', ['h', 'a', ' b']))
    expect(write(tree)).toBe(table('body-rows=1,1', ['h', 'a', ' b']))
  })
})

// C2-B-226: an empty last line is no record, so a last row of one empty cell stays quoted whichever group holds it.
describe('a lone empty last record stays quoted', () => {
  for (const [keys, rows] of [
    ['body-rows=0', ['""']],
    ['body-rows=1,0', ['h', '""']],
    ['header-rows=2 body-rows=0', ['h', '""']],
    ['footer-rows=1', ['h', '""']],
    ['header-rows=0 body-rows=1,0', ['""']],
  ] as const) {
    it(keys, () => {
      const source = table(keys, [...rows])
      expect(formatWithDiagnostics(source).source).toBe(source)
    })
  }
})
