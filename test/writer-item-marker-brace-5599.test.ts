import { describe, expect, it } from 'vitest'
import { format, formatWithDiagnostics, parse, treesEqual } from '../src/index.ts'

// carve-js#5599, C2-B-101, C2-W-088: attributes abut an item marker, so a letter, roman or bare-dot marker glued to a
// valid brace block opens an item. Text of that shape keeps a backslash on the delimiter.
describe('C2-W-088: a text item marker glued to a brace block', () => {
  it.each([
    ['1. a.\\{.c} An alpha item.\n', '1. a\\.{.c} An alpha item.\n'],
    ['- a.\\{.c} x\n', '- a\\.{.c} x\n'],
    ['a.\\{.c} x\n', 'a\\.{.c} x\n'],
    ['> A)\\{.c} x\n', '> A\\){.c} x\n'],
    ['1. iv\\.{a=b} x\n', '1. iv\\.{a=b} x\n'],
    ['- [ ] IV)\\{.c}{#d} x\n', '- [ ] IV\\){.c}{#d} x\n'],
    ['.\\{.c} x\n', '\\.{.c} x\n'],
    ['1. \\.{.c} x\n', '1. \\.{.c} x\n'],
    // No valid block, or no marker: the line is text and takes no backslash.
    ['a.\\{.c x\n', 'a.{.c x\n'],
    ['ab.\\{.c} x\n', 'ab.{.c} x\n'],
    ['- para\n  z)\\{.c} x\n', '- para\n  z){.c} x\n'],
  ])('writes %j as %j', (source, expected) => {
    const tree = parse(source)
    const written = formatWithDiagnostics(source)
    expect(written.diagnostics).toEqual([])
    expect(written.source).toBe(expected)
    expect(format(expected)).toBe(expected)
    expect(treesEqual(parse(expected), tree)).toBe(true)
  })
})
