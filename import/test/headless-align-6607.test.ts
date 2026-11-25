import { describe, expect, it } from 'vitest'
import { importDocument } from '../src/index.ts'

const carve = (html: string, reported: string[] = []): string => {
  const result = importDocument(html, { from: 'html' })
  expect(result.diagnostics.map(diagnostic => diagnostic.code)).toEqual(reported)
  return result.source
}
const row = (...cells: string[]): string => `<table><tr>${cells.map((cell, at) => `<td${cell}>${String(at)}</td>`).join('')}</tr></table>`

describe('C2-M-040: a headless column gives its alignment only after aligned columns (carve#6607)', () => {
  it('a right-aligned second column keeps its cell mark when the first has none', () => {
    expect(carve(row('', ' align="right"'))).toBe('| 0 |{>} 1 |\n')
  })
  it('the list stops at the first column that gives none, and later cells keep their marks', () => {
    expect(carve(row(' align="center"', '', ' align="right"'))).toBe('{aligns=center}\n| 0 | 1 |{>} 2 |\n')
  })
  it('each axis on its own', () => {
    expect(carve(row(' valign="top"', ' align="left" valign="top"'))).toBe('{valigns=top,top}\n| 0 |{<} 1 |\n')
  })
  it('a baseline column gives none, so a later bottom column keeps its marks', () => {
    // C2-W-062: the baseline cell mark has no spelling and is reported on its own.
    expect(carve(row(' valign="baseline"', ' valign="bottom"'), ['field-unspellable'])).toBe('| 0 |{?v} 1 |\n')
  })
})
