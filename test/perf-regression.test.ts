import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

// Regression guards for two O(n^2) parser paths:
//
//   A) Inline "tail" regexes (RE_LINK_TAIL, RE_SPAN_TAIL, RE_CRITIC_INS/DEL)
//      backtracked to end-of-input at O(n) distinct positions when their
//      mandatory close delimiter (`)`, `}`, `+}`, `-}`) never appeared, e.g.
//      `![x](`×n, `[x](`×n, `[x]{`×n, `{+`×n. The fix precomputes suffix
//      tables and skips a regex whose close delimiter no longer lies ahead.
//
//   B) Block-attribute runs folded `mergeAttrs` per block, recopying a growing
//      classes array, so `{.c}`×n was quadratic. The fix accumulates into a
//      single mutable builder and materializes the Attrs once.
//
// Each case measures wall time at n and 2n; a linear path keeps the ratio near
// 2x (bounded well under 3x here) while the old quadratic path blew past it
// (ratio ~4x with multi-second absolute times at these sizes). Absolute bounds
// stay generous so shared-runner scheduler noise does not cause flakes.

/** Minimum elapsed ms over a few runs (min is the most stable perf floor). */
function timeMin(fn: () => void, runs = 3): number {
  let best = Infinity
  for (let r = 0; r < runs; r++) {
    const t = performance.now()
    fn()
    best = Math.min(best, performance.now() - t)
  }
  return best
}

const shapes: Array<{ name: string; unit: string }> = [
  { name: 'link/image tail (no closing paren)', unit: '![x](' },
  { name: 'reference/link tail (no closing paren)', unit: '[x](' },
  { name: 'span tail (no closing brace)', unit: '[x]{' },
  { name: 'critic insert (no closing +})', unit: '{+' },
  { name: 'block attributes', unit: '{.c}' },
]

describe('parser perf regression (near-linear scaling)', () => {
  for (const { name, unit } of shapes) {
    it(`${name} scales near-linearly`, () => {
      const n = 50000
      const small = unit.repeat(n)
      const large = unit.repeat(n * 2)

      // Warm up so JIT state does not skew the first measured size.
      carveToHtml(unit.repeat(1000))

      const tSmall = timeMin(() => void carveToHtml(small))
      const tLarge = timeMin(() => void carveToHtml(large))

      // Both sizes finish fast; the quadratic version took multiple seconds.
      expect(tSmall).toBeLessThan(2000)
      expect(tLarge).toBeLessThan(2000)

      // Doubling the input must not more-than-double-ish the time. A quadratic
      // path yields ~4x; linear yields ~2x. Guard at 3x with a small-time floor
      // so millisecond-scale runs are not judged by a noisy ratio.
      if (tSmall > 20) {
        expect(tLarge / tSmall).toBeLessThan(3)
      }
    })
  }
})
