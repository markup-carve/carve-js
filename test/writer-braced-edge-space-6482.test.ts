import { describe, expect, it } from 'vitest'
import { parseWithLayout } from '../src/api.ts'
import { format, parse, treesEqual } from '../src/index.ts'
import { writeTreeWithStats } from '../src/write.ts'

// carve#6482, C2-W-069: an emphasis or strong whose content starts or ends with a space or a line break has no bare
// form that pairs, so it is braced in every round, the kind rounds of C2-W-088 included.
const CASES: [string, string][] = [
  ['{*\\`\n*}~\\`*`*\n', '{*\\`\n*}~\\`*\\`*\n'],
  ['{/\\`\n/}~\\`/`/\n', '{/\\`\n/}~\\`/\\`/\n'],
  ['{*{  *}{{*x*} {/{ /}{{/x/} {*{ *} {{*{x*} a *b*\n', '{*{  *}\\{*x* {/{ /}\\{/x/ {*{ *} \\{*{x* a *b*\n'],
  ['x {* a*} y\n', 'x {* a*} y\n'],
  ['x {*a *} y\n', 'x {*a *} y\n'],
  ['x {*a\\\n*} y\n', 'x {*a\\\n*} y\n'],
  ['x {/\\ a/} y\n', 'x {/\\ a/} y\n'],
  ['x {/a /} y\n', 'x {/a /} y\n'],
]

const UNIT = '{*{  *}{{*x*} {/{ /}{{/x/} {*{ *} {{*{x*} a *b* '
const WRITTEN = '{*{  *}\\{*x* {/{ /}\\{/x/ {*{ *} \\{*{x* a *b* '

function pairs(units: number): string {
  return `${UNIT.repeat(units).trimEnd()}\n`
}

describe('an emphasis or strong with a space at a content edge (carve#6482)', () => {
  it.each(CASES)('writes %j as %j', (input, expected) => {
    const written = format(input)
    expect(written).toBe(expected)
    expect(treesEqual(parse(written), parse(input))).toBe(true)
    expect(format(written)).toBe(written)
  })

  it('C2-W-010: a paragraph of such pairs is written the same for every unit, with parses that do not grow with it', () => {
    const counts = [8, 32, 128].map((units) => {
      const parsed = parseWithLayout(pairs(units), { extensions: [] })
      const result = writeTreeWithStats(parsed.document, { layout: parsed.layout }, 'repair', false)
      expect(result.output.source).toBe(`${WRITTEN.repeat(units).trimEnd()}\n`)
      return result.stats.parses
    })
    expect(counts[2]).toBe(counts[0])
  })
})
