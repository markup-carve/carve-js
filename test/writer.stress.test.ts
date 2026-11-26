// Writer cases that take seconds; outside the everyday run, `npm run test:stress` runs them, and CI does.
import { expect, it } from 'vitest'
import { format, parse, treesEqual } from '../src/index.ts'

// C2-W-088 (carve-js#5283, option B): the rounds are bounded by the kinds, so the chain completes and reads back
// instead of reaching the repair limit of C2-W-133 (carve-js#5366 tracks its time).
it('C2-W-133: a long repeated reference label chain completes without a refusal', () => {
  const source = `x ${'[a][\\]'.repeat(4_000)}`
  expect(treesEqual(parse(format(source)), parse(source))).toBe(true)
}, 20_000)

// carve-js#5572: more than about 125,000 inline children in one block overflowed the stack.
it('C2-W-010: a paragraph and a quote of about 140,000 inline children format back to themselves', () => {
  const paragraph = 'a *b* '.repeat(70_000)
  expect(format(paragraph)).toBe(`${paragraph.trimEnd()}\n`)
  const quote = '> a\n'.repeat(100_000)
  expect(format(quote)).toBe(quote)
}, 120_000)
