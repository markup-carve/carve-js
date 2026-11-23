import { describe, expect, it } from 'vitest'
import { lint } from './lint.ts'

// The glued attribute run of an inline node was searched from every brace inside the node, so nested spans
// with braced quotes cost a scan to the node's end per brace and per node.
const best = (source) => {
  let fastest = Infinity
  for (let run = 0; run < 3; run++) {
    const started = performance.now()
    lint(source)
    fastest = Math.min(fastest, performance.now() - started)
  }
  return fastest
}

const nested = (depth, closed) => `a ${'[{"{'.repeat(depth)}[{x${']{.c}"'.repeat(closed)}`

describe('inline attribute runs in linear time', () => {
  for (const [name, ratio] of [['nested spans closed to a quarter', 0.27], ['nested spans closed', 1]]) {
    it(`lints 8 times the ${name} in at most about 8 times the time`, () => {
      const small = nested(250, Math.round(250 * ratio))
      const large = nested(2000, Math.round(2000 * ratio))
      lint(small)
      expect(best(large)).toBeLessThan(Math.max(best(small), 2) * 24)
    }, 120_000)
  }

  it('keeps the attribute records of nested spans', () => {
    expect(lint('[[x]{#a}]{#a}\n').map((entry) => `${entry.code}@${entry.range.startOffset}`)).toEqual(['duplicate-id@5'])
  })
})
