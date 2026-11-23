import { describe, expect, it } from 'vitest'
import { format, parse, treesEqual, writeWithDiagnostics } from '../src/index.ts'
import type { ParagraphNode, TextNode } from '../src/ast.ts'

describe('C2-W-125, case eight: a text ^[ stays bare and the ] that closed it early takes the backslash (carve#6471)', () => {
  it.each([
    ['^[ \\]} [^[b]\\]][]'],
    ['x ^[a \\] b \\] [^[b] c][] z'],
    ['- ^[ [x] \\]} [^a[b]][].'],
    ['> ^[ *s* \\] [^[b] c][]'],
    ['x ^[q `c` \\], [^a[b]][]'],
    ['x ^[ [x] \\] [^[[b]]][].'],
    ['^[a \\] ^[ \\] [^[b] c][] z'],
    ['^\\[ ] ^[x [^[b]\\]][]]'],
    ['^[a \\] ^[n [^[b]\\]][]\\]'],
    ['^[a \\] ^[ \\] [^a[b]][] ^[n [^[b]\\]][]\\]'],
    ['^[a \\] [^[x] y](/u)'],
  ])('writes the tree of %j back as it was written', (source) => {
    const canonical = `${source}\n`
    const tree = parse(source)
    const written = writeWithDiagnostics(tree)
    expect(written.diagnostics).toEqual([])
    expect(written.source).toBe(canonical)
    expect(treesEqual(parse(written.source), tree)).toBe(true)
    expect(format(canonical)).toBe(canonical)
  })
})

describe('C2-W-125, case eight: the opener of a supplied tree can stand across two text nodes', () => {
  it('writes ^ and [ ]} as one text ^[ with its early closer escaped', () => {
    const tree = parse('^[ \\]} [^[b]\\]][]')
    const paragraph = tree.children[0] as ParagraphNode
    const text = paragraph.children[0] as TextNode
    paragraph.children.splice(0, 1, { type: 'text', value: '^' }, { type: 'text', value: text.value.slice(1) })
    const written = writeWithDiagnostics(tree)
    expect(written.diagnostics).toEqual([])
    expect(written.source).toBe('^[ \\]} [^[b]\\]][]\n')
  })
})
