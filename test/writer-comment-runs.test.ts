// A run of comment lines is walked once per group and once per sibling list: the bridge check of the group end and
// the attribute lookahead of each sibling used to walk the whole run again for every comment.
import { describe, expect, it } from 'vitest'
import { format } from '../src/index.ts'
import { expectBuiltInputScansLinearly, perfIt } from './helpers/scaling.ts'

describe('fmt on runs of comment lines', () => {
  it('keeps comment lines and an attribute line behind them in place', () => {
    expect(format('%%\n%%\n%%\n')).toBe('%%\n%%\n%%\n')
    expect(format('- a\n%%\n%%\n{.c}\nx\n')).toBe(format(format('- a\n%%\n%%\n{.c}\nx\n')))
  })

  perfIt('scales linearly on comment lines', () => {
    expectBuiltInputScansLinearly(source => { format(source) }, count => '%%\n'.repeat(count),
      { label: 'comment lines', smallRepeats: 4_000 })
  })
})
