// A line of `[{^` openers gave the targeted rescue one candidate, and one whole-document render, per opener.
import { expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

function fastest(source: string): number {
  let best = Infinity
  for (let run = 0; run < 3; run++) {
    const started = performance.now()
    upgrade(source)
    best = Math.min(best, performance.now() - started)
  }
  return best
}

it('the targeted rescue stays linear on a line of bracketed openers', () => {
  const doc = (n: number): string => '{^*['.repeat(n) + 'x\n'
  const small = fastest(doc(200))
  const large = fastest(doc(1600))
  expect(large / Math.max(small, 1)).toBeLessThan(8)
}, 120_000)

it('a small document keeps every rescue candidate past the first 64', () => {
  const source = '```\n' + '</# '.repeat(200) + '\n```\n\n\\</#x>\n'
  const result = upgrade(source)
  expect(result.check).toBe('pass')
  expect(result.records.map((record) => record.entry)).toContain('U-181')
})
