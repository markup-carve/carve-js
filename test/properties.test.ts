// Properties of every document: one owner per line, balanced events, ordered offsets,
// no exception, and a tree that a trailing blank line does not change. See support/checks.ts.
import { describe, expect, it } from 'vitest'
import {
  acquireState, buildTree, columnAt, lineAt, lineEndAt, parseBlockTree, releaseState, scanBlocks,
} from '../src/index.ts'
import { checkDocument } from './support/checks.ts'
import { enumerateDocuments, LINE_SHAPES } from './support/enumerate.ts'
import { shape, shapeOf } from './support/shape.ts'

describe('enumerated documents', () => {
  for (const lines of [1, 2, 3]) {
    it(`every document of ${lines} lines over ${LINE_SHAPES.length} line shapes`, () => {
      const result = enumerateDocuments(lines)
      expect(result.documents).toBe(LINE_SHAPES.length ** lines)
      expect(result.failures).toEqual([])
    })
  }
})

describe('source and line model', () => {
  it('the empty document has no lines and no blocks', () => {
    expect(shape('')).toBe('')
    expect(checkDocument('')).toBeNull()
  })

  it('a carriage return before the line feed is not content', () => {
    expect(shape('- a\r\n- b\r\n\r\n```\r\nx\r\n```\r\n')).toBe('ul(-)[li[p"a"] li[p"b"]] code"x"')
    expect(checkDocument('- a\r\n\r\n  b\r\n')).toBeNull()
  })

  it('the line table gives line, line end and column of an offset', () => {
    const src = 'ab\n\tc\r\n\nd'
    const state = acquireState()
    try {
      scanBlocks(state, src)
      expect(state.lineCount).toBe(4)
      expect(Array.from(state.lineStarts.subarray(0, 4))).toEqual([0, 3, 7, 8])
      expect(lineAt(state.lineStarts, state.lineCount, 2)).toBe(0)
      expect(lineAt(state.lineStarts, state.lineCount, 4)).toBe(1)
      expect(lineAt(state.lineStarts, state.lineCount, 8)).toBe(3)
      expect(lineEndAt(src, state.lineStarts, state.lineCount, 1)).toBe(5)
      expect(lineEndAt(src, state.lineStarts, state.lineCount, 3)).toBe(9)
      // C2-B-004, C2-B-005: the tab ends at column 4 of its line.
      expect(columnAt(src, state.lineStarts, state.lineCount, 4)).toBe(4)
    } finally {
      releaseState(state)
    }
  })

  it('a node keeps offsets into the one source string', () => {
    const src = '> - a\n>   b\n'
    const list = parseBlockTree(src).children![0]!.children![0]!
    const paragraph = list.children![0]!.children![0]!
    expect([list.start, list.end]).toEqual([2, 11])
    expect(paragraph.spans).toEqual([4, 5, 10, 11])
  })
})

describe('reused state', () => {
  it('a parse started inside another one takes its own state from the pool', () => {
    const outer = acquireState()
    try {
      scanBlocks(outer, '- a\n- b')
      expect(shape('> nested')).toBe('quote[p"nested"]')
      expect(shapeOf('- a\n- b', buildTree(outer.events, outer.eventLength))).toBe('ul(-)[li[p"a"] li[p"b"]]')
    } finally {
      releaseState(outer)
    }
  })

  it('the event array and the line table grow', () => {
    const src = '- a\n\n'.repeat(5000)
    expect(parseBlockTree(src).children![0]!.children!.length).toBe(5000)
    expect(checkDocument(src)).toBeNull()
  })
})
