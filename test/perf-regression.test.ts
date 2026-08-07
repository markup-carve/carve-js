import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'
import { expectBuiltInputScansLinearly, expectScansLinearly, perfIt } from './helpers/scaling.js'

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

// `ratioMedian` lived here: the median of three TOTAL-elapsed ratios, guarding
// at 3.5 where healthy reads ~2.0 and quadratic ~4.0. The median was the right
// instinct and it is kept; the metric was the problem, since a 1.14x margin
// below the quadratic signal cannot survive a shared runner. It moved to
// test/helpers/scaling.ts as a PER-BYTE ratio with 2x margins on both sides.

const shapes: Array<{ name: string; unit: string }> = [
  { name: 'link/image tail (no closing paren)', unit: '![x](' },
  { name: 'reference/link tail (no closing paren)', unit: '[x](' },
  { name: 'span tail (no closing brace)', unit: '[x]{' },
  { name: 'critic insert (no closing +})', unit: '{+' },
  { name: 'block attributes', unit: '{.c}' },
]

describe('parser perf regression (near-linear scaling)', () => {
  for (const { name, unit } of shapes) {
    // Left as an ABSOLUTE cap on purpose - see the reasoning inside. Gated only
    // so it does not run concurrently with the rest of the suite, which is what
    // made a 2000ms cap on a ~40ms operation fail.
    perfIt(`${name} scales near-linearly`, () => {
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
    // A SINGLE trailing `}` far away: the delimiter exists, so the old suffix
    // guard passed and the flat regex scanned to it at every `[`.
    //
    // This used to compare TOTAL elapsed at n and 2n against a 3.5 guard, which
    // reads ~2.0 when healthy and ~4.0 when quadratic - a 1.14x margin below
    // the thing it must catch. It went red twice in a day at 3.65 and 3.51
    // (carve-js#570) and again at 4.49 on a loaded machine. The shared helper
    // compares cost PER BYTE at a 4x multiple instead: ~1.0 healthy, ~4.0
    // quadratic, guard at 2.0, so the margin is 2x on both sides.
    perfIt(`${name} scales near-linearly`, () => {
      carveToHtml(unit.repeat(1000) + '}')
      expectScansLinearly((input) => void carveToHtml(input), unit, {
        suffix: '}',
        label: name,
      })
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

// D) Deeply-indented list staircase: each line indented one column more than the
//    last (`- x`, ` - x`, `  - x`, …). This drives the list dedent / content-column
//    re-basing path (reworked for carve#295/#322) to its maximum nesting. NOTE the
//    input BYTES grow quadratically with LINE COUNT (line i carries i leading
//    spaces), so a per-line measurement looks O(n^2); per BYTE it is LINEAR (a
//    pre-release audit flagged the line-count view as a false quadratic). This
//    guard pins the linear-in-bytes behavior: a ~177 KB staircase parses well
//    under the cap; a true quadratic-in-bytes regression would take many seconds.
describe('parser perf regression: deeply-indented list staircase', () => {
  it('nested-list dedent stays linear in input bytes', () => {
    const mk = (n: number) => Array.from({ length: n }, (_, i) => ' '.repeat(i) + '- x').join('\n')
    carveToHtml(mk(150)) // warm up
    const t = timeMin(() => void carveToHtml(mk(600)), 3)
    // ~250ms locally at 177 KB; a quadratic-in-bytes regression is multiple
    // seconds. Absolute cap (not a ratio) per this file's noise-robust convention.
    expect(t).toBeLessThan(2000)
  })
})

// E) A `+`-attached fence that can NEVER close: the container collectors look
//    ahead for the closer of the block a `+` attaches (carve-js#884), and an
//    opener with no closer ahead reads the whole remaining document. Repeating
//    such an opener is quadratic unless the lookahead can refute in O(1) - which
//    is what `closerIndex` does, the same negative index `%%%` already used.
//
//    THE WIDTHS MUST INCREASE. A repeated FIXED opener closes on its own
//    successor (a comment and a colon closer match on exact length; a code
//    closer matches at length OR LONGER), so every fixed-fragment spelling of
//    this shape reads linear whatever the scan does, and pins nothing.
//
//    The item's LOOSENESS precompute answers the same question and took the
//    sharper hit while it asked it per line - 4000 comment openers of increasing
//    width went from 137ms to 15s - but it is not guarded here: it is a single
//    stateful left-to-right pass, so it is linear by construction, and every
//    spelling of "many unclosable openers in ONE item" also grows the input
//    BYTES quadratically (each opener is one character wider), which makes the
//    per-byte reading pin a pre-existing cost rather than this one.
const unclosableShapes: Array<{ name: string; unit: string }> = [
  // A TYPED colon opener is not closer-shaped, so a run of them never closes
  // itself and the width can stay constant.
  { name: 'colon fence', unit: '- x\n+\n::: note\na\n\n' },
  // A code opener with an info string is likewise not closer-shaped.
  { name: 'code fence', unit: '- x\n+\n```js\na\n\n' },
]

describe('parser perf regression: a `+`-attached fence that never closes', () => {
  for (const { name, unit } of unclosableShapes) {
    perfIt(`an unclosable ${name} per continuation marker scales near-linearly`, () => {
      carveToHtml(unit.repeat(200))
      expectScansLinearly((input) => void carveToHtml(input), unit, {
        label: `unclosable ${name}`,
        smallRepeats: 500,
      })
    })
  }

  perfIt('an unclosable comment fence per continuation marker scales near-linearly', () => {
    // A comment closer takes an insignificant TAIL, so `%%% x` closes a `%%%`
    // and no constant-width run of openers is unclosable. The widths have to
    // increase, which grows the input bytes faster than the unit count - the
    // reason this one is built rather than repeated.
    expectBuiltInputScansLinearly(
      (input) => void carveToHtml(input),
      (repeats) =>
        Array.from({ length: repeats }, (_, i) => `- x\n+\n${'%'.repeat(3 + i)}\na\n`).join('\n'),
      { label: 'unclosable comment fence', smallRepeats: 400 },
    )
  })
})
