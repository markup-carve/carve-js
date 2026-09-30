import { describe, it, expect } from 'vitest'
import { timeCalls } from './helpers/scaling.js'

/*
 * carve-js#2420. The scaling guards do not run on pull requests, so the
 * measurement they depend on has no cover there. These assertions do: they
 * check the SAMPLING, which is deterministic, rather than any ratio.
 *
 * The defect was that `minSampleMs` bought averaging only for a call cheaper
 * than the budget. A ratio's two sides differ in per-call cost by construction,
 * so the cheap side averaged several calls and the expensive side exactly one,
 * and a single scheduler stall on that one unaveraged reading put main red at
 * 2.02x and 2.28x on two unrelated commits.
 */

/** Occupies the CPU for at least `ms`, so the call cannot be shorter than it. */
function burn(ms: number): void {
  const until = performance.now() + ms
  while (performance.now() < until) {
    /* spin */
  }
}

describe('a batched scaling sample averages several calls', () => {
  it('averages several calls even when one already exceeds the budget', () => {
    const { calls } = timeCalls(() => burn(20), 5)

    expect(calls).toBeGreaterThanOrEqual(4)
  })

  it('averages both sides of a ratio when they differ in per-call cost', () => {
    const cheap = timeCalls(() => burn(1), 20)
    const expensive = timeCalls(() => burn(40), 20)

    expect(expensive.calls).toBeGreaterThanOrEqual(4)
    expect(cheap.calls).toBeGreaterThanOrEqual(4)
  })

  it('measures one call when no budget is asked for', () => {
    // The guards that pass no budget must stay at one call per sample. This is
    // the slowest job in the repository and a floor there would multiply it.
    expect(timeCalls(() => burn(1)).calls).toBe(1)
  })

  it('reports the mean of the batch, not its total', () => {
    const { msPerCall, calls } = timeCalls(() => burn(20), 5)

    expect(calls).toBeGreaterThanOrEqual(4)
    expect(msPerCall).toBeGreaterThanOrEqual(20)
    expect(msPerCall).toBeLessThan(20 * calls)
  })
})
