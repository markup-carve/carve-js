// carve-js#5366: the shapes of the full writer gates that failed on next2 after the option B pin train.
import { expect, it } from 'vitest'
import { format, parse, treesEqual } from '../src/index.ts'
import { parseWithLayout } from '../src/api.ts'
import { writeTreeWithStats } from '../src/write.ts'
import { checkWriter } from './support/writer-checks.ts'

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
  expect(once).toBe('{=\\`=}[^"]\n\\`\n:\n')
  expect(format(once)).toBe(once)
})

// C2-W-088, C2-W-125 case two: a quote that the round's parse holds in another direction is reported with the other
// constructs of that parse. Where escaping a braced opener alone restores the quote's direction, the round ends there.
it.each([
  ['x\\<="[', 'x\\<="\\[\n'],
  ['x{-"\\-}', 'x\\{-"-}\n'],
  ["x{-'\\-}", "x\\{-'-}\n"],
  ['x<\\="{*', 'x\\<="\\{*\n'],
  ["x<\\='{/", "x\\<='\\{/\n"],
])('C2-W-088: a quote read in another direction in the same round %j', (input, expected) => {
  expect(bothPaths(input)).toEqual([expected, expected])
})

// C2-W-125, case seven: where the text before the quote changes in the same round, a sigil opener behind it takes the
// backslash at its bracket; with nothing behind the quote, its left neighbor takes none.
it.each([
  ['x<\\=":n[', 'x\\<=":n\\[\n'],
  ['x<<\\="', 'x\\<\\<="\n'],
])('C2-W-125: the neighbors of a quote behind a changing text %j', (input, expected) => {
  expect(format(input)).toBe(expected)
})

// C2-W-125 case five: the backslash before the `/` of an inner `/}` gives no kind, and the text behind the content
// that ended early opens nothing, so no `}` takes one.
it.each([
  ['x(/u)\\/}/}', 'x({/u)\\/}/}}\n'],
  ['x(/u)\\/}/}a}', 'x({/u)\\/}/}}a}\n'],
  ['x(*u)\\*}*}', 'x({*u)\\*}*}}\n'],
  // The parse can open a construct on the closing mark of the tree there, which asks for no escape either.
  ['x(/u)\\/}/}a/', 'x({/u)\\/}/}}a/\n'],
])('C2-W-125: no escape behind a content that ended early %j', (input, expected) => {
  expect(bothPaths(input)).toEqual([expected, expected])
})

// The four-token inputs the gate reference read differently: a quote of the tree read the other way is no opener of
// its own (C2-W-125 case two), and a kind round escapes every bracket run (C2-W-088).
it.each([
  ['x(/u)\\/}/}', 'x({/u)\\/}/}}\n'],
  ['x\\<a:b>\\="', 'x\\<a:b\\>="\n'],
  ["x\\<a:b>\\='", "x\\<a:b\\>='\n"],
  ['x[^:n[\\]', 'x\\[^:n\\[]\n'],
])('C2-W-088: the gates and the reference agree on %j', (input, expected) => {
  expect(bothPaths(input)).toEqual([expected, expected])
  expect(checkWriter(input)).toBeNull()
})
