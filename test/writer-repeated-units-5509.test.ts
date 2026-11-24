import { describe, expect, it } from 'vitest'
import { parseWithLayout } from '../src/api.ts'
import { format, parse, treesEqual } from '../src/index.ts'
import { writeTreeWithStats } from '../src/write.ts'

// carve-js#5509, C2-W-069, C2-W-093, C2-W-010: a paragraph of repeated braced pairs is written with repair parses that
// do not grow with the number of units, and every unit after the first is written the same.
const UNITS: [string, string, string][] = [
  // A strong whose content holds `*}` takes the braced form before the first round.
  ['{{*x*\\} {{{x*} ', '{{*x\\*} {{{x*}', '\\{{*x\\*} {{{x*}'],
  // The content closer `*}` of each braced strong takes its backslash in the same round.
  ['*} {{*x*} {*}*{ *} b* ', '{*} {{*x*} \\{\\*}*}\\{ *} b*', '{*} {{*x*} \\{\\*}*}\\{ *} b*'],
]

function paragraph(unit: string, units: number): string {
  return `${unit.repeat(units).trimEnd()}\n`
}

describe('repeated braced pairs in one paragraph (carve-js#5509)', () => {
  it.each(UNITS)('writes %j repeated with the same bytes for every later unit', (unit, first, later) => {
    for (const units of [1, 3, 4, 10]) {
      const input = paragraph(unit, units)
      const written = format(input)
      expect(written).toBe(`${[first, ...Array<string>(units - 1).fill(later)].join(' ')}\n`)
      expect(treesEqual(parse(written), parse(input))).toBe(true)
      expect(format(written)).toBe(written)
    }
  })

  it.each(UNITS)('C2-W-010: the repair parses of %j do not grow with the units', (unit) => {
    const counts = [8, 32, 128].map((units) => {
      const parsed = parseWithLayout(paragraph(unit, units), { extensions: [] })
      const result = writeTreeWithStats(parsed.document, { layout: parsed.layout }, 'repair', false)
      expect(result.output.diagnostics).toEqual([])
      return result.stats.parses
    })
    expect(counts[2]).toBe(counts[0])
  })

  it('keeps the bare form where the content mark cannot close it', () => {
    for (const [input, expected] of [['/a{/b/\n', '/a{/b/\n'], ['*x *} y*\n', '*x *} y*\n'], ['/a /*b/ c\n', '/a /*b/ c\n']]) {
      expect(format(input!)).toBe(expected)
    }
  })
})
