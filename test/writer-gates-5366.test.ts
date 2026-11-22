// carve-js#5366: the shapes of the full writer gates that failed on next2 after the option B pin train.
import { expect, it } from 'vitest'
import { format, parse, treesEqual } from '../src/index.ts'
import { parseWithLayout } from '../src/api.ts'
import { writeTreeWithStats } from '../src/write.ts'

function bothPaths(input: string): [string, string] {
  const parsed = parseWithLayout(input)
  const write = (path: 'plan' | 'repair'): string =>
    writeTreeWithStats(parsed.document, { layout: parsed.layout }, path, false, undefined, input).output.source
  return [write('plan'), write('repair')]
}

// C2-W-088: the bare parse reads the line below an escaped line opener below the block that opener opened.
it.each([
  ['\\* a\n2. a', '\\* a\n2\\. a\n'],
  ['- x\n  \\* a\n  2. a', '- x\n  \\* a\n  2\\. a\n'],
  ['> \\* a\n> 2. a', '> \\* a\n> 2\\. a\n'],
  ['[^a]: x\n* a\n  2. a', '[^a]: x\n  \\* a\n  2\\. a\n'],
  ['[^a]: x\n1. a\n3) a', '[^a]: x\n  1\\. a\n  3\\) a\n'],
  ['\\# a\n2. a', '\\# a\n2\\. a\n'],
])('C2-W-088: the line below an escaped opener %j', (input, expected) => {
  expect(bothPaths(input)).toEqual([expected, expected])
})

// C2-W-092: a paragraph that starts on a later line opens nothing there; only the block above it ended.
it.each([
  ['\\- \\```\n: d', '\\- \\```\n: d\n'],
  ['[^a]: x\n- ```\n~~~', '[^a]: x\n  \\- \\```\n  ~~~\n'],
  ['[^a]: x\n- ```\n{.a}', '[^a]: x\n  \\- \\```\n  {.a}\n'],
  ['[^a]: x\n- ```\n|', '[^a]: x\n  \\- \\```\n  |\n'],
])('C2-W-092: no line escape where the parse starts a paragraph %j', (input, expected) => {
  expect(format(input)).toBe(expected)
})

// C2-W-075, C2-W-010: the references recorded with the same text take the tree form in one round, so the parses
// do not grow with the references the depth cap of C2-I-118 moves.
it('C2-W-010: a repeated reference label chain takes a constant number of parses', () => {
  for (const count of [1_000, 4_000]) {
    const input = `x ${'[a][\\]'.repeat(count)}`
    const parsed = parseWithLayout(input)
    const result = writeTreeWithStats(parsed.document, { layout: parsed.layout }, 'plan', false, undefined, input)
    expect(result.stats.parses).toBeLessThanOrEqual(6)
    expect(treesEqual(parse(result.output.source), parse(input))).toBe(true)
  }
})

// C2-W-003: the resync of the comparison reads lines from the written spelling, not from the source of the tree.
it('C2-W-003: a reference label over a line end formats like its folded spelling', () => {
  const once = format('{=\\`=}[^\n"]\n`\n:')
  expect(once).toBe('{=\\`=}[^"]\n`\n:\n')
  expect(format(once)).toBe(once)
})
