/** Compare work at two sizes sixteen times apart without favoring either size's warm-up. */
export function growthRatio(small: () => void, large: () => void, samples = 3): { ratio: number, times: number[] } {
  small()
  large()
  const times = [Infinity, Infinity]
  for (let run = 0; run < samples; run++) {
    const calls = run % 2 === 0 ? [small, large] : [large, small]
    const indices = run % 2 === 0 ? [0, 1] : [1, 0]
    for (let index = 0; index < 2; index++) {
      const started = performance.now()
      calls[index]!()
      times[indices[index]!] = Math.min(times[indices[index]!]!, performance.now() - started)
    }
  }
  const ratio = times[1]! / Math.max(times[0]!, 0.5)
  if (process.env.CARVE_GROWTH_REPORT) {
    console.log(`growth: ${times.map((time) => time.toFixed(2)).join(', ')} ms; ratio ${ratio.toFixed(2)}`)
  }
  return { ratio, times }
}
