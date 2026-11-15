// The writer after the reader fixes: opener words end at their character set (C2-B-117, C2-B-119).
import { describe, expect, it } from 'vitest'
import { parse, writeWithDiagnostics, type DocumentNode } from '../src/index.ts'

const FENCE = '```'

/** The first block of `src` with `field` set to `value`, as a supplied tree. */
function supplied(src: string, field: string, value: unknown): DocumentNode {
  const tree = parse(src)
  Object.assign(tree.children[0]!, { [field]: value })
  return tree
}

function codes(tree: DocumentNode, check: boolean): string[] {
  return writeWithDiagnostics(tree, { check }).diagnostics.map((entry) => entry.code)
}

describe('opener words of a supplied tree', () => {
  it('C2-W-037, C2-B-117: a language outside the characters of a language word is left out and reported', () => {
    for (const syntax of ['js}', 'a b', 'é', 'x{1}', 'c`']) {
      const tree = supplied(`${FENCE}js\nx\n${FENCE}\n`, 'syntax', syntax)
      expect(writeWithDiagnostics(tree).source, syntax).toBe(`${FENCE}\nx\n${FENCE}\n`)
      expect(codes(tree, false), syntax).toEqual(['field-unspellable'])
    }
    for (const syntax of ['c++', 'objective-c', 'x/y', 'c#', 'a.b_C9']) {
      const tree = supplied(`${FENCE}js\nx\n${FENCE}\n`, 'syntax', syntax)
      expect(writeWithDiagnostics(tree).source, syntax).toBe(`${FENCE}${syntax}\nx\n${FENCE}\n`)
      expect(codes(tree, true), syntax).toEqual([])
    }
  })

  it('C2-B-116, C2-I-021: a raw format outside the characters of a format name is reported', () => {
    const tree = supplied(`${FENCE}=html\nx\n${FENCE}\n`, 'format', 'html}')
    expect(codes(tree, false)).toEqual(['field-unspellable'])
    expect(codes(supplied(`${FENCE}=html\nx\n${FENCE}\n`, 'format', 'x-y_1'), true)).toEqual([])
  })

  it('C2-W-039, C2-B-119: a class outside the characters of a div name moves to the attribute line', () => {
    for (const name of ['glossary>', 'a.b', 'x}', 'é']) {
      const tree = supplied('::: box\nx\n:::\n', 'attrs', { classes: [name] })
      const out = writeWithDiagnostics(tree)
      expect(out.source, name).toBe(`{class="${name}"}\n:::\nx\n:::\n`)
      expect(out.diagnostics, name).toEqual([])
    }
  })
})
