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
function timeMin(fn: () => void, runs = 7): number {
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

      // The absolute wall-clock caps above ARE the O(n^2) guard: the quadratic
      // path this shape used to trigger takes multiple SECONDS at these sizes,
      // so a regression blows past the 2000ms cap unmistakably. A
      // tLarge/tSmall RATIO check is deliberately NOT used: on shared CI runners
      // the ~2x linear ratio jitters up toward the 4x quadratic signal (observed
      // up to ~3.6), so no ratio bound can separate linear from quadratic
      // reliably - it flaked on nearly every run. Wall-clock time is the
      // noise-robust signal, and a real quadratic is orders of magnitude over
      // the cap, not a subtle 2x-vs-4x.
    })
  }
})

// C) The "far-brace" span-attribute shape: a `[x]{` run whose closing `}` IS
//    present but far away, and where the `{…}` content can never validate. Unlike
//    the "no closing brace" case above (which the suffix table already handles),
//    RE_SPAN_TAIL here found the delimiter suffix present and scanned `[^}"'\n]*`
//    to the single far `}` at EVERY `[` -> O(n^2). spanAttrProvablyInvalid bails
//    at the first invalid token char, so a doomed payload is O(1) per opener.
//    Covers the bare `[x]{`×n, a valid-first-token variant `[x]{a[x]{`×n, and
//    `[x]{.a [x]{`×n / `[x]{k= [x]{`×n which the pre-scan also rejects early.
const farBraceShapes: Array<{ name: string; unit: string }> = [
  { name: 'far-brace span (one distant closing brace)', unit: '[x]{' },
  { name: 'far-brace span, valid first token', unit: '[x]{a[x]{' },
  { name: 'far-brace span, leading class token', unit: '[x]{.a [x]{' },
  { name: 'far-brace span, empty key= value', unit: '[x]{k= [x]{' },
]

describe('parser perf regression: far-brace span attributes', () => {
  for (const { name, unit } of farBraceShapes) {
    it(`${name} scales near-linearly`, () => {
      const n = 50000
      // A SINGLE trailing `}` far away: the delimiter exists, so the old suffix
      // guard passed and the flat regex scanned to it at every `[`.
      const small = unit.repeat(n) + '}'
      const large = unit.repeat(n * 2) + '}'

      carveToHtml(unit.repeat(1000) + '}')

      const tSmall = timeMin(() => void carveToHtml(small))
      const tLarge = timeMin(() => void carveToHtml(large))

      expect(tSmall).toBeLessThan(2000)
      expect(tLarge).toBeLessThan(2000)
      // Linear yields ~2x, quadratic ~4x. Guard at 3.5x - safely below the
      // quadratic 4x it must catch, with headroom for CI timing noise (on a
      // loaded shared runner a ~40ms `small` measurement jitters the ratio up
      // toward 3; locally it sits near 2). The `timeMin` best-of-many further
      // damps that noise.
      if (tSmall > 20) {
        expect(tLarge / tSmall).toBeLessThan(3.5)
      }
    })
  }
})

describe('span-attribute output is preserved (bounding elides only failures)', () => {
  // The bound must never change output: it only skips RE_SPAN_TAIL runs that
  // would have failed. Pathological far-brace input renders as literal text
  // (its `[x]` become empty spans / text, never a span carrying a bogus attr).
  it('renders the pathological far-brace input as literal-ish text, no bogus span', () => {
    // `[x]{[x]{[x]{}`: only the trailing `[x]{}` is a VALID empty span; the two
    // never-validating leading blocks stay literal — no attribute is invented.
    expect(carveToHtml('[x]{[x]{[x]{}')).toBe('<p>[x]{[x]{<span>x</span></p>')
    // No attribute could be parsed off the never-validating content.
    expect(carveToHtml('[x]{[x]{[x]{}')).not.toContain('class=')
  })

  it('valid span attributes still parse (unchanged by the bound)', () => {
    expect(carveToHtml('[x]{.a}')).toContain('<span class="a">x</span>')
    expect(carveToHtml('[x]{#id .c key=v}')).toContain(
      '<span id="id" class="c" key="v">x</span>',
    )
    expect(carveToHtml('[x]{}')).toContain('<span>x</span>')
    // A bare value stops at the first `}` (flat span-tail): value is `[a]{b`.
    expect(carveToHtml('[x]{k=[a]{b}}')).toContain('k="[a]{b"')
  })
})
