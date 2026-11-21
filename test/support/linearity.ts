import { cpuUsage } from 'node:process'

/** Excess growth above which a check fails. A quadratic path at factor 8 reads about 8. */
export const LINEARITY_LIMIT = 3

const collect = (globalThis as { gc?: () => void }).gc ?? ((): void => {})

/** Process CPU time in microseconds: time the runner spends on other processes does not count. */
function cpuMicros(): number {
  const usage = cpuUsage()
  return usage.user + usage.system
}

/**
 * How much faster than linear `large` grows, ported from carve-php's `Linearity::excess` (carve-php#5275).
 *
 * `large` works on an input `factor` times the size of `small`'s. It is timed against `small` run `factor` times back to
 * back, in the same interleaved rounds, so load and clock speed hit both sides alike: linear work reads about 1,
 * quadratic work about `factor`. The fastest sample of each side counts, and a reading over the limit is measured
 * again up to `attempts` times: noise passes on a retry, a quadratic path never does. Returns the lowest reading.
 */
export function linearityExcess(small: () => unknown, large: () => unknown, factor: number, rounds = 3, attempts = 3): number {
  small()
  large()
  let best = Number.POSITIVE_INFINITY
  for (let attempt = 0; attempt < attempts && best > LINEARITY_LIMIT; attempt++) {
    let batch = Number.POSITIVE_INFINITY
    let single = Number.POSITIVE_INFINITY
    for (let round = 0; round < rounds; round++) {
      collect()
      let start = cpuMicros()
      for (let index = 0; index < factor; index++) small()
      batch = Math.min(batch, cpuMicros() - start)
      collect()
      start = cpuMicros()
      large()
      single = Math.min(single, cpuMicros() - start)
    }
    best = Math.min(best, single / Math.max(1, batch))
  }
  if (process.env['CARVE_GROWTH_REPORT'] !== undefined) console.log(`linearity excess ${best.toFixed(2)} at factor ${factor}`)
  return best
}
