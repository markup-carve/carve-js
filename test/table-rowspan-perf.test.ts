import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

// Regression guard for the O(rows^2) rowspan resolution. The renderer walked up
// every prior row per `^` marker to find its origin; a tall all-`^` table was
// quadratic (16k rows ~2.8s). The fix carries the nearest-non-skipped row per
// column, so each `^` resolves in O(1). Output must stay identical.
describe('table rowspan resolution (perf)', () => {
  it('resolves a tall all-^ table in linear time', () => {
    const rows = 16000
    const source = '|= a |= b |\n' + '| ^ | ^ |\n'.repeat(rows)

    const start = performance.now()
    const html = carveToHtml(source)
    const elapsed = performance.now() - start

    // The header cells span the whole table.
    expect(html).toContain(`rowspan="${rows + 1}"`)
    // Linear is tens of ms; the previous quadratic was seconds at this size.
    expect(elapsed).toBeLessThan(2000)
  })
})
