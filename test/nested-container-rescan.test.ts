import { describe, it, expect } from 'vitest'
import { parse, layoutWork } from '../src/parse.js'

/**
 * COUNTED guard on the container-layout work (markup-carve/carve#752).
 *
 * Parsing a nested container hands its body to a nested parse, so a line at
 * depth `d` is handled `d` times. That is the container model and it is not what
 * this guards. What it guards is the CHARACTER work at each of those handlings:
 * while every level re-measured the whole indentation run and re-copied the
 * whole body, an `O(bytes)` document cost `O(bytes^1.5)` of work - 267x the
 * document's own size on a depth-200 ladder, growing without bound in depth.
 *
 * COUNTED, not timed, deliberately. This repo has already tried a clock twice
 * and written down why it cannot express this bound:
 *
 *   - `test/writer-deep-list-perf.test.ts`: "No ratio guard here on purpose.
 *     [...] A ratio bound tight enough to catch a partial regression would also
 *     fail on the healthy build."
 *   - `test/perf-regression.test.ts`: a `tLarge/tSmall` ratio check "flaked on
 *     nearly every run".
 *
 * A count is a property of the algorithm rather than of the machine: every
 * figure below reproduces byte-identically across runs and loads. An absolute
 * wall-clock cap has the opposite failure - it passes at any complexity on a
 * fast enough machine, one of the dead-check variants catalogued in
 * markup-carve/carve#755.
 *
 * The counter deliberately does NOT charge `String.prototype.slice`. V8 returns
 * a SlicedString for a result of 13 characters or more and un-nests a slice of
 * a slice, so a body line dedented once per level shares one backing store and
 * costs O(1) per level. What it DOES charge is every loop this parser runs over
 * characters itself, plus every full re-copy of a body (`join` / `split` /
 * newline normalization) - which is what the recursion seam used to do twice
 * per level, and which no engine optimizes away.
 *
 * WHAT THIS DOES NOT COVER, said plainly so the guard is not read as more than
 * it is. It counts the container LAYOUT machinery - the indent gate, the column
 * strip and the recursion seam - and those are what this change made linear.
 * The parse as a whole is still superlinear on a deep ladder, because other
 * per-line predicates read through the indentation too and are asked at every
 * level: the position anchor's suffix test, the blank-line class test, and the
 * two list-marker patterns. Measured on a depth-200 ladder they are 27.8%,
 * 17.8% and 11.5% of the remaining parse. Removing THEM needs the per-line
 * offset model markup-carve/carve#752 describes, which is not this change; the
 * wall-clock growth per depth doubling went 6.03 to 5.36, not to 3.94. A guard
 * that claimed otherwise would be one of the checks that cannot fail.
 */

const ladder = (d: number): string =>
  Array.from({ length: d }, (_, i) => ' '.repeat(2 * i) + '- x').join('\n') + '\n'
const quoteLadder = (d: number): string =>
  Array.from({ length: d }, (_, i) => '> '.repeat(i + 1) + 'x').join('\n') + '\n'
/** Same line count and same per-line widths as `ladder`, with no nesting. */
const flat = (d: number): string =>
  Array.from({ length: d }, (_, i) => 'x'.repeat(2 * i + 3)).join('\n') + '\n'

interface Counted {
  gate: number
  strip: number
  seam: number
  total: number
  bytes: number
}

function count(src: string): Counted {
  layoutWork.reset()
  layoutWork.on = true
  try {
    parse(src)
  } finally {
    layoutWork.on = false
  }
  return {
    gate: layoutWork.gate,
    strip: layoutWork.strip,
    seam: layoutWork.seam,
    total: layoutWork.total,
    bytes: src.length,
  }
}

describe('the container layout does not re-scan a body per level', () => {
  // At depth 200 - the deepest a conforming document reaches, since
  // MAX_NESTING_DEPTH is 200 - both shapes are 40,600 bytes.
  const l200 = count(ladder(200))
  const l100 = count(ladder(100))
  const q200 = count(quoteLadder(200))
  const q100 = count(quoteLadder(100))
  const f200 = count(flat(200))

  // LIVENESS. Every assertion below is an upper bound, so a counter that
  // stopped counting would satisfy all of them. These are the floor that makes
  // a dead counter fail instead: the flat control must read about one pass over
  // its own bytes (it is the document's own split), and the ladder must charge
  // all three counters, because the fix moved work out of two of them and a
  // silent zero there is indistinguishable from the fix by the bounds alone.
  it('counts - a dead counter fails here rather than passing everything else', () => {
    expect(f200.total).toBeGreaterThanOrEqual(f200.bytes)
    expect(l200.gate).toBeGreaterThan(0)
    expect(l200.strip).toBeGreaterThan(0)
    expect(l200.seam).toBeGreaterThan(0)
  })

  // A. ABSOLUTE. A bounded number of passes over the document, not a number
  // that grows with how deep it nests. Healthy is 3.5x (a capped indent gate,
  // a capped column strip, and the document's own one split); before the fix
  // it was 267.6x and rising with depth.
  it('walks a bounded number of passes of layout over a deep ladder', () => {
    expect(l200.total).toBeLessThanOrEqual(6 * l200.bytes)
    expect(q200.total).toBeLessThanOrEqual(6 * q200.bytes)
  })

  // B. GROWTH - the load-bearing half. Doubling the depth quadruples the bytes
  // (3.94x here), so the work must not do worse than that. This is a statement
  // about the SHAPE of the curve rather than its constant, and it fires even
  // with A raised past usefulness: before the fix the ratio was 7.86 on the
  // list ladder and 7.83 on the quote ladder, against 3.99 and 3.94 now.
  it('grows no faster than the document does', () => {
    expect(l200.total / l100.total).toBeLessThanOrEqual(4.4)
    expect(q200.total / q100.total).toBeLessThanOrEqual(4.4)
  })

  // C. CONTROL. A ladder against size-matched flat prose. This is what stops a
  // uniformly slower parser from satisfying A and B by making everything cost
  // more: the control moves with it. Before the fix the ladder cost 267.6x the
  // flat document of the same size.
  it('costs no more than flat text of the same size', () => {
    expect(l200.total).toBeLessThanOrEqual(6 * f200.total)
    expect(q200.total).toBeLessThanOrEqual(6 * f200.total)
  })

  // The ladder above is made of bullets, and a guard that only ever sees one
  // line shape cannot see a residual that a different shape still pays -
  // exactly the residual markup-carve/carve-rs#742 found in its own first
  // attempt. These are the other shapes that drive the same collectors.
  it.each([
    ['ordered', (d: number) => Array.from({ length: d }, (_, i) => ' '.repeat(3 * i) + '1. x').join('\n') + '\n'],
    ['task', (d: number) => Array.from({ length: d }, (_, i) => ' '.repeat(2 * i) + '- [ ] x').join('\n') + '\n'],
    [
      'prose holding a colon',
      (d: number) => Array.from({ length: d }, (_, i) => ' '.repeat(2 * i) + '- Note: a b c').join('\n') + '\n',
    ],
    [
      'a colon run that opens nothing',
      (d: number) =>
        Array.from({ length: d }, (_, i) => ' '.repeat(2 * i) + '- ::: not an opener x').join('\n') + '\n',
    ],
    [
      'tab indentation',
      (d: number) => Array.from({ length: d }, (_, i) => '\t'.repeat(i) + '- x').join('\n') + '\n',
    ],
    [
      'quotes alternating with items',
      (d: number) =>
        Array.from({ length: d }, (_, i) => ' '.repeat(2 * i) + (i % 2 ? '> x' : '- x')).join('\n') + '\n',
    ],
    [
      'a ladder followed by lazy continuation',
      (d: number) =>
        Array.from({ length: d }, (_, i) => ' '.repeat(2 * i) + '- x').join('\n') +
        '\n' +
        Array.from({ length: d }, () => ' '.repeat(2 * d) + 'lazy tail').join('\n') +
        '\n',
    ],
  ])('grows no faster than the document does: %s', (_name, gen) => {
    const a = count(gen(100))
    const b = count(gen(200))
    expect(a.total).toBeGreaterThan(0)
    expect(b.total / a.total).toBeLessThanOrEqual(4.4)
  })
})
