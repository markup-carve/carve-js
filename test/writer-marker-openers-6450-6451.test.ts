// carve#6450: a block opener behind the marker of another block on the same line takes its own escape (C2-W-088), for
// every container marker. carve#6451 (ruled option 1): a text whose only loss is a reported one did not read back
// (C2-W-124), so the group takes the reported-openers form of C2-W-088.
import { describe, expect, it } from 'vitest'
import { type DocumentNode, parse, writeWithDiagnostics } from '../src/index.ts'
import { treesEqual } from '../src/ast-json.ts'

type Inline = { type: 'text', value: string } | { type: 'soft_break' } | { type: 'code', value: string }

const text = (value: string): Inline => ({ type: 'text', value })
const soft: Inline = { type: 'soft_break' }

function paragraph(...children: Inline[]): DocumentNode {
  return { type: 'document', astVersion: '2.0', children: [{ type: 'paragraph', children }] } as DocumentNode
}

function wrapped(container: 'bullet' | 'quote', ...children: Inline[]): DocumentNode {
  const block = { type: 'paragraph', children }
  const node = container === 'quote'
    ? { type: 'block_quote', children: [block] }
    : { type: 'list', marker: { kind: 'bullet', char: '-' }, spacing: 'tight', children: [{ type: 'list_item', children: [block] }] }
  return { type: 'document', astVersion: '2.0', children: [node] } as DocumentNode
}

function codes(tree: DocumentNode): [string, string[]] {
  const result = writeWithDiagnostics(tree)
  return [result.source, result.diagnostics.map((entry) => entry.code)]
}

describe('carve#6450: openers behind a container marker', () => {
  it.each([
    ['- ```x', '\\- \\```x\nc\n'],
    ['1. ```x', '1\\. \\```x\nc\n'],
    ['* ```x', '\\* \\```x\nc\n'],
    ['> - x', '\\> \\- x\nc\n'],
    ['- - x', '\\- \\- x\nc\n'],
    ['a. ```x', 'a\\. \\```x\nc\n'],
    // A nested ordered marker takes the backslash at its delimiter (C2-W-090), a hyphen run at its second hyphen (C2-W-099).
    ['> 1. x', '\\> 1\\. x\nc\n'],
    ['1) 2) x', '1\\) 2\\) x\nc\n'],
    ['- 1. ```x', '\\- 1\\. \\```x\nc\n'],
    ['- -- x', '\\- -\\- x\nc\n'],
    ['> - > x', '\\> \\- \\> x\nc\n'],
  ])('writes %j and c', (first, expected) => {
    const tree = paragraph(text(first), soft, text('c'))
    expect(codes(tree)).toEqual([expected, []])
    expect(treesEqual(tree, parse(expected, { positions: false }))).toBe(true)
  })
})

describe('carve#6451: a reported loss takes the reported-openers form', () => {
  it('escapes only the reported opener after lost leading blanks (tree A)', () => {
    expect(codes(paragraph(text('a'), soft, text('  ` `'), soft, text('c')))).toEqual(['a\n  \\` `\nc\n', ['field-unspellable']])
  })

  it('reports the code span behind the lost blanks of an item line (tree B)', () => {
    expect(codes(wrapped('bullet', text('  x` `'), soft, text('c')))).toEqual(['-   x\\` `\n  c\n', ['field-unspellable']])
  })

  it.each([
    [wrapped('quote', text('a'), soft, text('  `x `'), soft, text('c')), '> a\n>   \\`x `\n> c\n'],
    [paragraph(text('/'), soft, text('  ` ` d')), '/\n  \\` ` d\n'],
    [paragraph(text('a'), soft, text('  ` ` `'), soft, text('c')), 'a\n  \\` \\` `\nc\n'],
    [wrapped('quote', text('  x` `'), soft, text('c')), '>   x\\` `\n> c\n'],
    [paragraph(text('a'), soft, text('  x` '), { type: 'code', value: 'z' }), 'a\n  x\\` `z`\n'],
    [paragraph(text('a b'), soft, text('  x` `')), 'a b\n  x\\` `\n'],
    // The rounds go on past the first reported opener: bare, the tick behind it pairs with the code span's run.
    [paragraph(text('a'), soft, text('  ` ` '), { type: 'code', value: 'z' }), 'a\n  \\` \\` `z`\n'],
  ])('writes the reported-openers form %#', (tree, expected) => {
    expect(codes(tree)).toEqual([expected, ['field-unspellable']])
    // The readback differs from the tree only in the lost blanks: no code span the tree does not hold.
    const read = JSON.stringify(parse(expected, { positions: false }))
    expect(read.includes('"code"')).toBe(JSON.stringify(tree).includes('"code"'))
  })
})
