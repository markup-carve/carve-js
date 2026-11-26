// carve-js#5371: a code span that the bare parse holds and the tree does not reports the backtick kind (C2-W-088),
// also where the escape that stops it comes from a probe of the content or the glued backtick of C2-W-125 case six.
import { expect, it } from 'vitest'
import { format } from '../src/index.ts'
import { parseWithLayout } from '../src/api.ts'
import { writeTreeWithStats } from '../src/write.ts'
import { checkWriter } from './support/writer-checks.ts'

function bothPaths(input: string): [string, string] {
  const parsed = parseWithLayout(input)
  const write = (path: 'plan' | 'repair'): string =>
    writeTreeWithStats(parsed.document, { layout: parsed.layout }, path, false, undefined, input).output.source
  return [write('plan'), write('repair')]
}

it.each([
  ['x{/\\`/}\\`', 'x{/\\`/}\\`\n'],
  ['x(/u)\\`/`', 'x(/u)\\`/\\`\n'],
  ['x{-\\`-}`', 'x{-\\`-}\\`\n'],
  ['x{*\\`*}`', 'x{*\\`*}\\`\n'],
  ['x{=\\`=}`', 'x{=\\`=}\\`\n'],
  ['x^[\\`]`', 'x^[\\`]\\`\n'],
  ['[a\\`b](https://x.y)`', '[a\\`b](https://x.y)\\`\n'],
  ['> x{/\\`/}\\`', '> x{/\\`/}\\`\n'],
  ['- x{*\\`*}`', '- x{*\\`*}\\`\n'],
])('C2-W-088: a probe that stops a code span gives the backtick kind %j', (input, expected) => {
  expect(bothPaths(input)).toEqual([expected, expected])
  expect(format(expected)).toBe(expected)
})

it.each([
  ['x`a`\\`a`{.c}', 'x`a`\\`a\\`{.c}\n'],
  ['x\\``a`\\`a`', 'x\\``a`\\`a\\`\n'],
  ['x``a`\\`\\`', 'x\\`\\`a`\\`\\`\n'],
  ['| x`a`\\`a` |', '| x`a`\\`a\\` |\n'],
])('C2-W-088, C2-W-125 case six: a glued backtick that lets the bare text pair other runs gives the kind %j', (input, expected) => {
  expect(bothPaths(input)).toEqual([expected, expected])
  expect(format(expected)).toBe(expected)
})

// C2-W-125 case six alone: no later run pairs in the bare text, so only the glued backtick takes a backslash.
it.each([
  ['x`a`\\`', 'x`a`\\`\n'],
  ['x`a`\\` ``` b', 'x`a`\\` ``` b\n'],
  // A raw span ends in its format suffix, so the backtick behind it lengthens nothing.
  ['x`a`{=html}`a``', 'x`a`{=html}`a``\n'],
])('C2-W-125 case six: a glued backtick alone gives no kind %j', (input, expected) => {
  expect(bothPaths(input)).toEqual([expected, expected])
  expect(checkWriter(input)).toBeNull()
})
