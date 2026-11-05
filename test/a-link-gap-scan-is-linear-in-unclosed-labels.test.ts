import { describe, expect, it } from 'vitest'
import { lintCarve } from '../src/lint.js'
import { expectBuiltInputScansLinearly, perfIt } from './helpers/scaling.js'

const gaps = (source: string) => lintCarve(source, {})
  .filter(warning => warning.rule === 'link-gap-before-destination')
  .map(warning => [warning.column, warning.end! - warning.start!])

describe('the link-gap lint on a line of labels without a closing bracket', () => {
  it('reports the same spans as the label regex it replaces', () => {
    expect(gaps('[a] (b)\n')).toEqual([[1, 7]])
    expect(gaps('[x [a] (b) [c](d) [e] ( f )\n')).toEqual([[1, 10], [12, 16]])
    expect(gaps('[l](u) [m] (v)\n')).toEqual([[1, 14]])
    expect(gaps('[a] () [b]\t( c)\n')).toEqual([[8, 8]])
    expect(gaps('[x [x [x\n')).toEqual([])
  })

  perfIt('lints a line of unclosed labels in linear time', () => {
    expectBuiltInputScansLinearly(
      (input) => void lintCarve(input, {}),
      (n) => `${'[x '.repeat(n)}\n`,
      { label: 'unclosed labels on one line', smallRepeats: 8000 },
    )
  })
})
