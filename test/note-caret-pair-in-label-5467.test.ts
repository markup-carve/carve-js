import { describe, expect, it } from 'vitest'
import { format, parse, treesEqual, writeWithDiagnostics } from '../src/index.ts'

const shape = (node: { type: string, value?: string, children?: unknown[] }): string =>
  node.type === 'text' ? `"${node.value}"` : `${node.type}(${(node.children ?? []).map((child) => shape(child as never)).join(' ')})`

describe('C2-I-089: a note that first closes in a later pass holds no note (#5467)', () => {
  it.each([
    ['^[^[^[b][[^b]\\[]]', 'paragraph(inline_footnote("^[^" link("b") "[]"))'],
    ['^[^[[b][c]]]', 'paragraph(inline_footnote("^[" link("b") "]"))'],
  ])('reads %j', (source, tree) => {
    expect(shape(parse(source).children[0] as never)).toBe(tree)
  })

  it('keeps the tree of the reproduction through format and write', () => {
    const tree = parse('^[^[^[b][[^b]\\[]]')
    const written = writeWithDiagnostics(tree)
    expect(written.diagnostics).toEqual([])
    expect(treesEqual(parse(written.source), tree)).toBe(true)
    expect(format(written.source)).toBe(written.source)
  })
})
