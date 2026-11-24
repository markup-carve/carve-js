// carve#6422: the prune of the repair decides its candidate backslashes in rounds of one parse each, so a group with
// many of them, as a list or paragraph with one per line, takes parses that do not grow with their number.
import { describe, expect, it } from 'vitest'
import { parseWithLayout } from '../src/api.ts'
import { format } from '../src/index.ts'
import { writeTreeWithStats } from '../src/write.ts'

function parses(source: string): number {
  const parsed = parseWithLayout(source)
  return writeTreeWithStats(parsed.document, { layout: parsed.layout }, 'plan', false, undefined, source).stats.parses
}

const SHAPES: readonly [string, string, string][] = [
  ['list lines with a heading', '* * * {\\{#i}\n* * * # h\n', '* * * {\\{#i}\n* * * = h\n'],
  ['paragraph lines with a brace attribute', '{\\{#i} a\n', '{\\{#i} a\n'],
  ['paragraph lines whose escapes are kept and taken out', '+ ^\\[^]\n+ x \\[^]\n+ {\\{*a*}\n', '+ ^\\[^]\n+ x \\[^]\n+ {\\{*a*}\n'],
]

describe('escape prune in rounds (carve#6422)', () => {
  for (const [name, line, written] of SHAPES) {
    it(`writes ${name} as before`, () => {
      expect(format(line.repeat(200))).toBe(written.repeat(200))
    })

    it(`parses ${name} a bounded number of times`, () => {
      const small = parses(line.repeat(50))
      const large = parses(line.repeat(400))
      expect(large).toBeLessThanOrEqual(small + 4)
    })
  }
})
