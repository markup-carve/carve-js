import { expect, test } from 'vitest'
import { parse, toAstJson } from '../src/index.js'

type Pos = { startLine: number; startColumn?: number; startOffset?: number }
type Node = { type: string; pos?: Pos; children?: Node[]; items?: Node[] }
const wire = (source: string): Node => toAstJson(parse(source)) as unknown as Node

// carve#5976: an indented description's leading indentation is inside its span, from its owner's content column.
test('an indented description starts at its owner content column', () => {
  expect(wire(':: t\n: a\n : b\n').children![0]!.items![2]!.pos).toMatchObject({ startLine: 3, startColumn: 1, startOffset: 9 })
  expect(wire('1. a\n   :: t\n   : +\n> q\n').children![0]!.items![0]!.children![1]!.items![1]!.pos)
    .toMatchObject({ startLine: 3, startColumn: 4, startOffset: 16 })
  // An item's continuation indent stays the item's.
  expect(wire('  - :: term\n    : definition\n').children![0]!.items![0]!.children![0]!.items![1]!.pos)
    .toMatchObject({ startLine: 2, startColumn: 5, startOffset: 16 })
  expect(wire('- a\n\n  :: t\n   : d\n').children![0]!.items![0]!.children![1]!.items![1]!.pos)
    .toMatchObject({ startLine: 4, startColumn: 3, startOffset: 14 })
})

test('a description nested in a description starts at the outer body column', () => {
  const outer = wire(' :: t\n : a\n   :: u\n   : b\n').children![0]!.items!
  expect(outer[1]!.pos).toMatchObject({ startLine: 2, startColumn: 1, startOffset: 6 })
  expect(outer[1]!.children![1]!.items![1]!.pos).toMatchObject({ startLine: 4, startColumn: 4, startOffset: 22 })
})
