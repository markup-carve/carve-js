import { describe, expect, it } from 'vitest'
import { parse } from '../src/index.js'
import { MAX_NESTING_DEPTH } from '../src/parse.js'
import { expectBuiltInputScansLinearly, perfIt } from './helpers/scaling.js'

// One item per level down to one level past the cap, then `repeats` sibling
// lines inside the innermost item. Every enclosing item re-reads those lines, so
// each costs work in proportion to its indent at each level; what must not grow
// is that cost as more lines follow.
const pastTheCap = (repeats: number): string => {
  const ladder = Array.from({ length: MAX_NESTING_DEPTH + 1 }, (_, i) => `${'  '.repeat(i)}- x`)
  const indent = '  '.repeat(MAX_NESTING_DEPTH + 1)
  return `${ladder.join('\n')}\n${`${indent}- y\n`.repeat(repeats)}`
}

describe('a list nested past the cap', () => {
  it('degrades the overflow to text in the innermost item', () => {
    const doc = parse(pastTheCap(2))
    expect(JSON.stringify(doc)).toContain('- y')
  })

  perfIt('parses each line past the cap at a constant cost', () => {
    expectBuiltInputScansLinearly((input) => void parse(input), pastTheCap, {
      label: 'lines past the nesting cap',
      smallRepeats: 100,
    })
  })
})
