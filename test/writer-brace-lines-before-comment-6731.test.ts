import { expect, test } from 'vitest'
import { format, formatWithDiagnostics, parse, treesEqual } from '../src/index.ts'

function clean(source: string, written: string): void {
  const result = formatWithDiagnostics(source)
  expect(result.diagnostics.map((d) => d.code)).toEqual([])
  expect(result.source).toBe(written)
  expect(format(written)).toBe(written)
  expect(treesEqual(parse(source), parse(written))).toBe(true)
}

test('carve#6731: stacked brace lines before a line comment escape only the first brace', () => {
  clean('\\{a}\n{b}\n%% c\n', '\\{a}\n{b}\n%% c\n')
  clean('\\{a}\n\\{b}\n\\{c}\n%% c\n', '\\{a}\n{b}\n{c}\n%% c\n')
  clean('\\{a}\n{b}\n%%\n', '\\{a}\n{b}\n%%\n')
  clean('> \\{a}\n> {b}\n> %% c\n', '> \\{a}\n> {b}\n> %% c\n')
  clean('- \\{a}\n  {b}\n  %% c\n', '- \\{a}\n  {b}\n  %% c\n')
})

test('carve#6731: a block behind the brace lines still escapes every brace line', () => {
  clean('\\{a}\n{b}\nx\n', '\\{a}\n\\{b}\nx\n')
  clean('y\n{a}\n%% c\n', 'y\n{a}\n%% c\n')
})
