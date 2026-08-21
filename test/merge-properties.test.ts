import { describe, expect, it } from 'vitest'

import { applyAstPatch, carveToAstJson, mergeAst } from '../src/index.js'
import { mergeMatchDpCells } from '../src/merge.js'

const clean = (source: string) => applyAstPatch(carveToAstJson(source), [])

function document(seed: number, count: number): string {
  let state = seed >>> 0
  const next = (): number => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state
  }
  return Array.from({ length: count }, (_, index) => `paragraph ${index} value ${next()}`).join('\n\n') + '\n'
}

describe('three-way merge properties', () => {
  it('a revision merged against an unchanged side is exactly that revision', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const base = document(seed, 3 + (seed % 9))
      const revision = `${base}\nadded ${seed}\n`
      const result = mergeAst(carveToAstJson(base), carveToAstJson(revision), carveToAstJson(base))
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.ast).toEqual(clean(revision))
    }
  })

  it('refuses ambiguous duplicate identity instead of inventing a pairing', () => {
    const base = 'same\n\nsame\n\ntail\n'
    const ours = 'same\n\ntail\n\nsame\n'
    const theirs = 'same edited\n\nsame\n\ntail\n'
    const result = mergeAst(carveToAstJson(base), carveToAstJson(ours), carveToAstJson(theirs))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.conflicts.map((conflict) => conflict.reason)).toContain(
        'concurrent-sequence-edit',
      )
    }
  })

  it('bounds a large ambiguous sibling list', () => {
    // COUNTED, not timed. This asserted `elapsed < 2_500` and the reading it
    // compared was 429ms on a box at loadavg 10 - 5.8x of headroom, against a
    // suite where ambient load alone has inflated a reading 10.4x on unchanged
    // code (carve-js#1268). So the bound described the runner.
    //
    // What it was really asking is countable. `matchSide` refuses to build its
    // longest-common-kind DP table once `bs.length * ss.length` passes
    // 1_000_000 and pairs the remaining kinds monotonically instead; that
    // refusal is the entire bound on an ambiguous mass edit. 2000 siblings on
    // each side is 4_000_000, so the table must never be built at all.
    const base = document(1, 2_000)
    const ours = base.replaceAll(' value ', ' ours ')
    const theirs = base.replaceAll(' value ', ' theirs ')

    mergeMatchDpCells.count = 0
    const result = mergeAst(carveToAstJson(base), carveToAstJson(ours), carveToAstJson(theirs))

    expect(mergeMatchDpCells.count).toBe(0)
    expect(result.ok).toBe(false)
  }, 10_000)

  it('still builds the DP table for a list small enough to afford it', () => {
    // The hole a bare `toBe(0)` above would leave: a counter that never
    // increments reads 0 for every input, so the guard would pass while
    // measuring nothing. 500 siblings is 250_000 pairs per side, inside the
    // threshold, so the table IS built - measured 500_000 cells across the two
    // sides. That is what makes the zero at 2000 mean the refusal fired.
    const base = document(1, 500)
    const ours = base.replaceAll(' value ', ' ours ')
    const theirs = base.replaceAll(' value ', ' theirs ')

    mergeMatchDpCells.count = 0
    mergeAst(carveToAstJson(base), carveToAstJson(ours), carveToAstJson(theirs))

    expect(mergeMatchDpCells.count).toBeGreaterThan(0)
    // Two sides, each capped at 1_000_000 pairs by the threshold.
    expect(mergeMatchDpCells.count).toBeLessThanOrEqual(2_000_000)
  }, 10_000)
})
