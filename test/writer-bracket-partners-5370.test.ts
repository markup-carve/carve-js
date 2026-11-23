// carve-js#5370: text brackets in the content of bracketed nodes, past the depth cap and below it.
import { expect, it } from 'vitest'
import { format, parse, treesEqual } from '../src/index.ts'
import { parseWithLayout } from '../src/api.ts'
import { writeTreeWithStats } from '../src/write.ts'

function shape(count: number): string {
  const parts = ['[a ', '*[a](u)*', '[x]: /u\n']
  let input = ''
  for (let at = 0; at < count; at++) input += parts[at % 3]
  return input
}

// C2-W-010, C2-W-088: the kind rounds escape the `]` of each escaped text `[x]` with it, so no link of the chain ends
// early, the repair reads a constant number of characters per character, and no node is lost past the depth cap.
it('C2-W-010: unclosed brackets past the depth cap take linear repair work', () => {
  for (const count of [2_400, 3_008, 6_000]) {
    const input = shape(count)
    const parsed = parseWithLayout(input)
    const result = writeTreeWithStats(parsed.document, { layout: parsed.layout }, 'plan', false, undefined, input)
    expect(result.output.diagnostics).toEqual([])
    const read = result.stats.work.reduce((total, [, chars]) => total + chars, 0)
    expect(read).toBeLessThanOrEqual(8 * input.length)
    expect(treesEqual(parse(result.output.source), parse(input))).toBe(true)
    expect(format(result.output.source)).toBe(result.output.source)
  }
})

it('C2-W-091: the shape below the depth cap keeps its bytes', () => {
  expect(format(shape(6))).toBe('[a *[a](u)*[x]: /u\n[a *[a](u)*[x]: /u\n')
})

// C2-W-125, case five: each bare `]` of the content that closes no bare `[` there ends the node early, so each one
// takes a backslash in the same round.
it.each([
  ['[\\]\\]]{}', '[\\]\\]]{}\n'],
  ['[a\\]\\]]{}', '[a\\]\\]]{}\n'],
  ['[\\]\\]\\]]{.c}', '[\\]\\]\\]]{.c}\n'],
  ['[[\\]]]{}', '[[]\\]]{}\n'],
  ['^[[]][[[\\]\\]]{}', '^[\\[\\]]\\[[[\\]\\]]{}\n'],
])('C2-W-125: the closing brackets of a content %j', (input, expected) => {
  expect(format(input)).toBe(expected)
})

// C2-W-088: a backslash of C2-W-125 gives no kind, so the brackets outside the content stay as the kinds leave them.
it.each([
  [':e[[]][][x\\]', ':e[\\[\\]]\\[]\\[x]\n'],
  ['^[[]\\[x]x]', '^[\\[\\]\\[x]x]\n'],
  ['[x]: /u\n\n[a \\[x\\] b](u)', '[x]: /u\n\n[a \\[x\\] b](u)\n'],
])('C2-W-088: the brackets around an escaped content %j', (input, expected) => {
  expect(format(input)).toBe(expected)
})

// C2-W-069: strong content that reads on past its end because its closer pairs later takes the braced form, at the
// start of a paragraph as after text.
it.each([
  ['{*[*}u*[*', '{*[*}u*[*\n'],
  ['x{*[*}u*[*', 'x{*[*}u*[*\n'],
  ['{/[/}u/[/', '{/[/}u/[/\n'],
])('C2-W-069: content read on past its end %j', (input, expected) => {
  expect(format(input)).toBe(expected)
})
