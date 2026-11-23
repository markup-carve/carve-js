import { expect, it } from 'vitest'
import { parseWithLayout, tabsExtensions } from '../src/index.ts'

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]!
}

// The small side runs about 100 ms in CI so one runner stall cannot carry the ratio; linear work grows 8 times.
it('converts extension source positions in linear work across the layout walk', () => {
  const source = (count: number): string => '[r]: /target\n\n' + Array.from({ length: count }, (_, at) =>
    `:::: tabs\n::: tab "T${at}"\nsee [r].\n:::\n::::\n\n`).join('')
  const options = { extensions: tabsExtensions }
  const inputs = [source(512), source(4096)]
  const samples: number[][] = [[], []]
  for (const input of inputs) parseWithLayout(input, options)
  for (let run = 0; run < 5; run++) {
    for (const index of run % 2 === 0 ? [0, 1] : [1, 0]) {
      const started = performance.now()
      parseWithLayout(inputs[index]!, options)
      samples[index]!.push(performance.now() - started)
    }
  }
  const times = samples.map(median)
  expect(times[1]! / times[0]!, times.map((time) => time.toFixed(1)).join(', ')).toBeLessThan(25)
}, 120_000)
