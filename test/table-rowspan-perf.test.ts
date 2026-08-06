import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'
import { expectScansLinearly, perfIt } from './helpers/scaling.js'

// Regression guard for the O(rows^2) rowspan resolution. The renderer walked up
// every prior row per `^` marker to find its origin; a tall all-`^` table was
// quadratic (16k rows ~2.8s). The fix carries the nearest-non-skipped row per
// column, so each `^` resolves in O(1). Output must stay identical.
describe('table rowspan resolution (perf)', () => {
  it('spans the header cells over every following ^ row', () => {
    // The correctness half, at a size the everyday suite can afford.
    const rows = 2000
    const html = carveToHtml('|= a |= b |\n' + '| ^ | ^ |\n'.repeat(rows))

    expect(html).toContain(`rowspan="${rows + 1}"`)
  })

  perfIt('resolves a tall all-^ table in linear time', () => {
    expectScansLinearly((input) => void carveToHtml('|= a |= b |\n' + input), '| ^ | ^ |\n', {
      label: 'tall all-^ table',
      smallRepeats: 4000,
    })
  })
})
