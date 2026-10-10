import { describe, it, expect } from 'vitest'
import { lowestAccusedRatio, timeCalls } from './helpers/scaling.js'

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

/*
 * carve-js#2691. One retry was not enough: main went red at 2.21x on a commit
 * that touched only the Djot importer, while the accusing guard measures
 * `parse` of nested blockquotes and read ~1.0x locally. Both samples were
 * contaminated by the same loaded runner. These assertions check the retry
 * POLICY, which is deterministic, rather than any ratio.
 */
describe('an accused scaling ratio is resampled until one clears', () => {
  /** Hands out the given ratios in order, and records how many were taken. */
  function sampler(ratios: number[]): { next: () => { ratio: number }; taken: () => number } {
    let taken = 0

    return {
      next: () => ({ ratio: ratios[taken++] ?? ratios[ratios.length - 1]! }),
      taken: () => taken,
    }
  }

  it('takes one sample when the first one clears', () => {
    const { next, taken } = sampler([1, 9, 9])

    expect(lowestAccusedRatio(next, 2).attempts).toBe(1)
    expect(taken()).toBe(1)
  })

  it('stops as soon as a resample clears', () => {
    const { next, taken } = sampler([2.21, 1.02, 9])
    const { measured, attempts } = lowestAccusedRatio(next, 2)

    expect(measured.ratio).toBe(1.02)
    expect(attempts).toBe(2)
    expect(taken()).toBe(2)
  })

  it('resamples past a second accusing reading', () => {
    const { next } = sampler([2.21, 2.05, 1.03])

    expect(lowestAccusedRatio(next, 2).measured.ratio).toBe(1.03)
  })

  it('reports the lowest reading it saw, not the last', () => {
    const { next, taken } = sampler([4.4, 2.1, 2.3, 2.6])
    const { measured, attempts } = lowestAccusedRatio(next, 2, 4)

    expect(measured.ratio).toBe(2.1)
    expect(attempts).toBe(4)
    expect(taken()).toBe(4)
  })

  it('gives up after the attempt bound so a real regression still reports', () => {
    const { next, taken } = sampler([4, 4, 4, 4, 4, 4])

    expect(lowestAccusedRatio(next, 2, 3).measured.ratio).toBe(4)
    expect(taken()).toBe(3)
  })
})
