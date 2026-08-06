import { expect, it } from 'vitest'

/**
 * Shared measurement for the scaling guards, ported from carve-php's
 * ScalingGuardTrait (carve-php#389, carve-php#845).
 *
 * A guard against a reintroduced O(n^2) path has to answer one question: does
 * the cost per unit of input stay flat as the input grows? Two ways of asking
 * it were in use here, and both measure the MACHINE as much as the algorithm:
 *
 * - An ABSOLUTE bound (`expect(elapsed).toBeLessThan(500)`) passes or fails on
 *   how busy the runner is. Nine of these failed in one local run at load 74 on
 *   16 cores, on a parser that had not changed.
 * - A ratio of TOTAL elapsed at n and 2n reads ~2.0 when healthy and ~4.0 when
 *   quadratic, so a 3.5 guard sits only 1.14x below the thing it must catch.
 *   That is carve-js#570, which put main red twice in a day at 3.65 and 3.51.
 *
 * This measures cost PER INPUT BYTE instead. "Linear" means per-byte cost is
 * constant as the input grows, so a healthy path reads ~1.0 whatever the size
 * multiple is, and a quadratic one reads the multiple itself. With a 4x
 * multiple the threshold sits at 2.0: 2x above the healthy reading and 2x below
 * a genuine regression, instead of 1.14x.
 *
 * Two sampling rules do the rest, and neither is optional:
 *
 * - INTERLEAVE the sizes, ALTERNATING which is timed first. Timing all the
 *   small runs and then all the large ones lets a runner that is busy for only
 *   part of the test skew one side of the ratio; a fixed small-then-large order
 *   within a round does the same thing more subtly, because the second sample
 *   is always taken later and load that ramps during the test lands on it.
 * - Take the MEDIAN of several rounds. A mean is dragged by one stall, and a
 *   minimum discards the information that the machine was loaded at all.
 */

/** Input repeat counts. The 4x multiple separates linear (~1x per byte) from quadratic (~4x). */
const SMALL_REPEATS = 12_500
const LARGE_REPEATS = 50_000

/** Odd, so the median is a real sample rather than a mean of two. */
const ROUNDS = 5

/** Healthy reads ~1.0, quadratic reads ~4.0 (the size multiple). */
const MAX_PER_BYTE_RATIO = 2.0

/** Catastrophic backstop per sample: the pre-fix quadratic took seconds here. */
const MAX_MS = 20_000

/**
 * Timing assertions are gated so they never run inside the everyday suite.
 *
 * They are the only tests whose outcome depends on what else the machine is
 * doing, and vitest runs files concurrently, so in the default suite they are
 * measuring each other. `npm run test:perf` sets CARVE_PERF and runs them.
 */
export const perfIt = process.env.CARVE_PERF ? it : it.skip

/** One timed call, in milliseconds. */
function time(fn: () => void): number {
  const start = performance.now()
  fn()

  return performance.now() - start
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)

  return sorted[Math.floor(sorted.length / 2)]!
}

/**
 * Assert that running `convert` over a repeated fragment scales linearly.
 *
 * @param convert Receives the built input; its cost is what gets measured.
 * @param fragment Repeated to build both samples.
 * @param options.suffix Appended once to each sample.
 * @param options.label Identifies the shape in failure output.
 */
export function expectScansLinearly(
  convert: (input: string) => void,
  fragment: string,
  options: {
    prefix?: string
    suffix?: string
    label?: string
    /**
     * Repeat count for the small sample. The large one is always 4x this, so
     * the healthy-vs-quadratic separation is unchanged; lower it only to keep a
     * shape whose fragment is long from building a needlessly large input.
     */
    smallRepeats?: number
  } = {},
): void {
  const prefix = options.prefix ?? ''
  const suffix = options.suffix ?? ''
  const label = options.label ?? fragment
  const smallRepeats = options.smallRepeats ?? SMALL_REPEATS
  const largeRepeats = smallRepeats * (LARGE_REPEATS / SMALL_REPEATS)

  const small = prefix + fragment.repeat(smallRepeats) + suffix
  const large = prefix + fragment.repeat(largeRepeats) + suffix

  // Prime any module-level caches so round 1 does not measure setup. The small
  // sample is the same shape, so it warms what the large one would.
  convert(small)

  const smallPerByte: number[] = []
  const largePerByte: number[] = []
  let worstSmall = 0
  let worstLarge = 0

  for (let round = 0; round < ROUNDS; round++) {
    let elapsedSmall: number
    let elapsedLarge: number

    if (round % 2 === 0) {
      elapsedSmall = time(() => convert(small))
      elapsedLarge = time(() => convert(large))
    } else {
      elapsedLarge = time(() => convert(large))
      elapsedSmall = time(() => convert(small))
    }

    smallPerByte.push(elapsedSmall / small.length)
    largePerByte.push(elapsedLarge / large.length)
    worstSmall = Math.max(worstSmall, elapsedSmall)
    worstLarge = Math.max(worstLarge, elapsedLarge)
  }

  expect(
    worstSmall,
    `${smallRepeats}x ${label} took ${worstSmall.toFixed(0)}ms (quadratic regression?)`,
  ).toBeLessThan(MAX_MS)
  expect(
    worstLarge,
    `${largeRepeats}x ${label} took ${worstLarge.toFixed(0)}ms (quadratic regression?)`,
  ).toBeLessThan(MAX_MS)

  const medianSmall = median(smallPerByte)
  const medianLarge = median(largePerByte)
  const ratio = medianLarge / Math.max(medianSmall, Number.EPSILON)
  const multiple = largeRepeats / smallRepeats

  expect(
    ratio,
    `Per-byte cost grew ${ratio.toFixed(2)}x for ${label} at ${multiple}x the input ` +
      `(linear ~1x, quadratic ~${multiple}x): ` +
      `small=${(medianSmall * 1000).toFixed(4)}us/byte large=${(medianLarge * 1000).toFixed(4)}us/byte`,
  ).toBeLessThan(MAX_PER_BYTE_RATIO)
}
