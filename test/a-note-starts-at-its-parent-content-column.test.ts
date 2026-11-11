import { expect, test } from 'vitest'
import { parse, toAstJson } from '../src/index.js'

type Pos = { startLine: number; startColumn?: number; startOffset?: number; endLine: number; endColumn?: number; endOffset?: number }
type Node = { type: string; label?: string; pos?: Pos; children?: Node[] }
const wire = (source: string): Node => toAstJson(parse(source)) as unknown as Node
const note = (doc: Node, label: string) => doc.children!.find((child) => child.type === 'footnote' && child.label === label)

// carve#5976: a note's leading indentation is inside its span, from its parent's content column.
test('an indented note starts at its parent content column', () => {
  expect(note(wire(' Note[^fn].\n\n [^fn]: body.\n'), 'fn')?.pos).toMatchObject({ startLine: 3, startColumn: 1, startOffset: 13 })
  expect(note(wire('> - t\n^ p\n>   [^f]: n\nl\n\nr[^f]\n'), 'f')?.pos).toMatchObject({ startLine: 3, startColumn: 3, startOffset: 12 })
  expect(note(wire('1. a\n\n    [^f]: b\n\n   x[^f]\n'), 'f')?.pos).toMatchObject({ startLine: 3, startColumn: 4, startOffset: 9 })
})

test('a list in an indented note anchors at the note content column', () => {
  const doc = wire('. d\n   [^n]: e\n     - a\n')
  expect(note(doc, 'n')?.pos).toMatchObject({ startColumn: 3, startOffset: 6 })
  expect(note(doc, 'n')!.children![1]!.pos).toMatchObject({ startColumn: 5, startOffset: 19 })
})
