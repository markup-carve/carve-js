import { describe, expect, it } from 'vitest'
import { lint } from './lint.ts'

// Each code span, math span or autolink looked up every ancestor path to count the block quotes around it, so
// nested inline openers cost the square of their depth per leaf.
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]

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

const PAIRS = [['$`', '`'], ['[', '](u)'], ['<', '>']]
const nested = (depth) => {
  let open = ''
  let close = ''
  for (let at = 0; at < depth; at++) {
    const [left, right] = PAIRS[at % PAIRS.length]
    open += left
    close = right + close
  }
  return `a ${open}x${close.slice(0, close.length >> 1)}\n`
}

describe('opaque inline leaves in linear time', () => {
  it('lints 8 times the nested openers in at most about 8 times the time', () => {
    const times = growth(lint, [1156, 9248].map(nested))
    expect(times[1] / Math.max(times[0], 2), times.map((time) => time.toFixed(1)).join(', ')).toBeLessThan(24)
  }, 120_000)

  it('still drops the quote marks inside a code span in a quote', () => {
    expect(lint('> `a\n> b`\n')).toEqual(lint('`a\nb`\n'))
  })
})
