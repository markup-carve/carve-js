import { describe, expect, it } from 'vitest'
import { lint } from './lint.ts'

// The glued attribute run of an inline node was searched from every brace inside the node, so nested spans
// with braced quotes cost a scan to the node's end per brace and per node.
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]

// The small side runs about 50 ms here and 100 ms in CI, so one runner stall cannot carry the ratio. Both sides
// alternate so a slow phase of the machine hits both.
const growth = (work, inputs) => {
  const samples = [[], []]
  for (const input of inputs) work(input)
  for (let run = 0; run < 5; run++) {
    for (const index of run % 2 === 0 ? [0, 1] : [1, 0]) {
      const started = performance.now()
      work(inputs[index])
      samples[index].push(performance.now() - started)
    }
  }
  return samples.map(median)
}

const nested = (depth, closed) => `a ${'[{"{'.repeat(depth)}[{x${']{.c}"'.repeat(closed)}`

describe('inline attribute runs in linear time', () => {
  for (const [name, ratio] of [['nested spans closed to a quarter', 0.27], ['nested spans closed', 1]]) {
    it(`lints 16 times the ${name} in at most about 16 times the time`, () => {
      const times = growth(lint, [4000, 64000].map((depth) => nested(depth, Math.round(depth * ratio))))
      expect(times[1] / Math.max(times[0], 2), times.map((time) => time.toFixed(1)).join(', ')).toBeLessThan(48)
    }, 120_000)
  }

  it('keeps the attribute records of nested spans', () => {
    expect(lint('[[x]{#a}]{#a}\n').map((entry) => `${entry.code}@${entry.range.startOffset}`)).toEqual(['duplicate-id@5'])
  })
})
