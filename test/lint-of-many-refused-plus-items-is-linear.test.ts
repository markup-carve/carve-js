import { describe, expect, it } from 'vitest'
import { lintCarve } from '../src/lint.js'
import { expectScansLinearly, perfIt } from './helpers/scaling.js'

describe('lint of many items with a refused + (carve-js#4962)', () => {
  it('reports one refusal per item', () => {
    const warnings = lintCarve('- +\n\n'.repeat(3), {})
    expect(warnings.map(warning => [warning.line, warning.column, warning.rule])).toEqual([
      [1, 3, 'continuation-marker-refused'],
      [3, 3, 'continuation-marker-refused'],
      [5, 3, 'continuation-marker-refused'],
    ])
  })

  it('still names the nearest earlier item a marker sits below', () => {
    const rules = (source: string) => lintCarve(source, {}).map(warning => `${warning.line}:${warning.rule}`)
    expect(rules('- a\n\n- b\n\n - c\n')).toEqual(['5:list-marker-below-content-column'])
    expect(rules('- a\n  - b\n\n - c\n')).toEqual(['4:list-marker-below-content-column'])
  })

  perfIt('scales linearly in the number of items', () => {
    expectScansLinearly((input) => void lintCarve(input, {}), '- +\n\n', { smallRepeats: 2000 })
  })
})
