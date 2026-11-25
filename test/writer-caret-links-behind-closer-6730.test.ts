import { expect, test } from 'vitest'
import { format, formatWithDiagnostics, parse, treesEqual } from '../src/index.ts'

function clean(source: string, written: string): void {
  const result = formatWithDiagnostics(source)
  expect(result.diagnostics.map((d) => d.code)).toEqual([])
  expect(result.source).toBe(written)
  expect(format(written)).toBe(written)
  expect(treesEqual(parse(source), parse(written))).toBe(true)
}

test('carve#6730: only the first caret link behind an early note closer keeps its caret bare', () => {
  clean('^[\\] text [\\^](u) [\\^](v)\n', '^[\\] text [^](u) [\\^](v)\n')
  clean('^[\\] text [^](u) [\\^](v)\n', '^[\\] text [^](u) [\\^](v)\n')
  clean('^[\\]\n[\\^](u) [\\^](v)\n', '^[\\]\n[^](u) [\\^](v)\n')
})

test('carve#6730: a footnote reference between the closer and a caret link leaves it to the rounds', () => {
  clean('^[\\] [^a](u) [\\^](u)\n', '^[\\] [^a](u) [\\^](u)\n')
})

test('carve#6730: a link whose text is a caret and a space is no case eight', () => {
  clean('^[\\] [\\^ b](u)\n', '^[\\] [\\^ b](u)\n')
})
