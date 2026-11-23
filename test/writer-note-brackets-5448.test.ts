import { describe, expect, it } from 'vitest'
import { format, formatWithDiagnostics, parse, treesEqual } from '../src/index.ts'

const cases: [string, string][] = [
  // #5448: bare, the bracket text reads as a reference link across the closers of the marks and the note around it.
  ['^[/*[]\\[*/]/]\n', '^[/*\\[\\]\\[*/]/]\n'],
  ['^[{^*[]\\[*^}]^}]\n', '^[{^*\\[\\]\\[*^}]^}]\n'],
  ['x [/*[]\\[*/]{.c}\n', 'x [/*\\[\\]\\[*/]{.c}\n'],
  ['^[/*[]\\[*/]\n', '^[/*\\[\\]\\[*/]\n'],
  // The link reports the kind `[`, so the `[` behind the note takes its backslash too.
  ['x ^[*\\[*][]] y\n', 'x ^[*\\[*]\\[]] y\n'],
]

describe('C2-W-088, C2-W-125: a bracket text that reads as a link across the closers around it (#5448)', () => {
  it.each(cases)('writes %j as %j', (source, expected) => {
    const output = formatWithDiagnostics(source)
    expect(output.diagnostics).toEqual([])
    expect(output.source).toBe(expected)
    expect(treesEqual(parse(output.source), parse(source))).toBe(true)
    expect(format(output.source)).toBe(output.source)
  })
})
