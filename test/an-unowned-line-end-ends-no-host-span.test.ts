import { expect, test } from 'vitest'
import { parse, toAstJson } from '../src/index.js'

type Pos = { startLine: number; startColumn?: number; startOffset?: number; endLine: number; endColumn?: number; endOffset?: number }
type Node = { type: string; label?: string; pos?: Pos; children?: Node[]; items?: Node[] }
const wire = (source: string): Node => toAstJson(parse(source)) as unknown as Node
const span = (node: Node | undefined) => node?.pos && [node.pos.startOffset, node.pos.endOffset]
const note = (doc: Node, label: string) => doc.children!.find((child) => child.type === 'footnote' && child.label === label)

// carve-js#4955: the `%%` stand-in is wider than the `+`; a host measured to its line's end stops at the `+`.
test('a description holding only its consumed plus ends after the plus', () => {
  const list = wire(':: t\n: [^q]: +\n- y\n\nr[^q]\n').children![0]!
  expect(span(list.items![1])).toEqual([5, 14])
  expect(span(list)).toEqual([0, 14])
})

test('a note holding only its consumed plus ends after the plus', () => {
  const doc = wire('[^m]: +\n[^n]: +\n[^n]: +\n  para\n\nsee[^m][^n]\n')
  expect(span(note(doc, 'm'))).toEqual([0, 7])
})

// carve#5975: the closer a container synthesizes for an unclosed fence owns no source.
test('an empty unclosed fence a refused plus ends owns only its opener', () => {
  const item = wire('- ```\n+\n').children![0]!.items![0]!
  expect(item.children![0]!.pos).toMatchObject({ startLine: 1, startColumn: 3, endLine: 1, endColumn: 6, startOffset: 2, endOffset: 5 })
  expect(span(item)).toEqual([0, 5])
})

test('an unclosed raw fence a refused plus ends stops after its payload', () => {
  const item = wire('- ```=html\n  x\n+\n\ntail\n').children![0]!.items![0]!
  expect(span(item.children![0])).toEqual([2, 14])
})

// carve-js#4956: the trailing blank an own-line attached fence keeps is payload.
test('an own-line plus fence spans the trailing blank it keeps', () => {
  const list = wire(':: t\n: p\n+\n```\ncode\n\n  tail\n\nx\n').children![0]!
  const description = list.items![1]!
  expect(span(description.children![1])).toEqual([11, 29])
  expect(span(description)).toEqual([5, 29])
  expect(span(list)).toEqual([0, 29])
})
