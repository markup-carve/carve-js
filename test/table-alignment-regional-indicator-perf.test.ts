import { describe, expect, it } from 'vitest'
import { parse } from '../src/parse.js'
import { renderCarve } from '../src/index.js'
import { tableDisplayWidth, tableGraphemeClusters } from '../src/table-display-width.js'
import { expectScansLinearly, perfIt } from './helpers/scaling.js'

const FLAG_A = '\u{1F1E6}'

describe('table alignment over a run of regional indicators', () => {
  it('pairs the run into flags and counts each pair once', () => {
    expect(tableGraphemeClusters(FLAG_A.repeat(5))).toEqual([...Array(2).fill(FLAG_A + FLAG_A), FLAG_A])
    expect(tableDisplayWidth(FLAG_A.repeat(2001))).toBe(1001)
  })

  perfIt('aligns a table whose cell holds a long regional-indicator run in linear time', () => {
    expectScansLinearly(
      (input) => void renderCarve(parse(input), { alignTables: true }),
      FLAG_A,
      { prefix: '| a | b |\n|---|---|\n| ', suffix: ' | x |\n', label: 'regional-indicator run in a cell', smallRepeats: 2000 },
    )
  })
})
