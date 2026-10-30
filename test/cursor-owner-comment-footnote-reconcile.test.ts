import { describe, expect, it } from 'vitest'

import { parse } from '../src/index.js'
import { parseCursorPrototype, UnsupportedCursorSyntax } from '../src/parse/cursor-prototype.js'

function expectExact(source: string): void {
  expect(parseCursorPrototype(source), source).toStrictEqual(parse(source))
  expect(parseCursorPrototype(source, { positions: false }), source)
    .toStrictEqual(parse(source, { positions: false }))
}

function expectExactOrDeclined(source: string): void {
  try {
    expect(parseCursorPrototype(source), source).toStrictEqual(parse(source))
  } catch (error) {
    if (!(error instanceof UnsupportedCursorSyntax)) throw error
  }
}

describe('cursor owner reconciliation: comment and footnote ownership', () => {
  it.each([
    '- intro\n%% c\n\n- tail\n',
    '- intro\n%% c\n\n - tail\n',
    '- intro\n%% c\n\n  - tail\n',
    '- intro\n%% c\n\n    - tail\n',
    '- intro\n%% c\n\n\n- tail\n',
    '- intro\n%% c\n\n1. tail\n',
  ])('keeps a flush-left comment in its item across a blank before a sibling: %s', expectExact)

  it('loosens the list and ends the item at its paragraph for a comment kept across a blank', () => {
    const list = parseCursorPrototype('- intro\n%% c\n\n- tail\n').children[0]
    expect(list).toMatchObject({ type: 'list', tight: false })
    const [item] = (list as { items: Array<{ children: Array<{ type: string }>; pos: { endLine: number } }> }).items
    expect(item!.children.map((child) => child.type)).toEqual(['paragraph', 'comment'])
    expect(item!.pos.endLine).toBe(1)
  })

  it.each([
    '  [^g]: more\n  a\n',
    '  [^g]: more\n  text\n  x\n',
    '  [^g]: more\n   text\n',
    '  [^g]: more\n    b\n  text\n',
    '  [^g]: more\n\n  text\n',
  ])('keeps the source column of a cut continuation line in an indented footnote: %s', expectExact)

  it('extends an indented footnote through its continuation line', () => {
    const actual = parseCursorPrototype('  [^g]: more\n  a\n')
    expect(actual.children).toEqual([])
    const [note] = actual.footnoteDefs!.g as Array<{ children: Array<{ type: string }> }>
    expect(note!.children.map((child) => child.type)).toEqual(['text', 'soft_break', 'text'])
    expect(actual.footnoteDefPos!.g).toMatchObject({ startLine: 1, endLine: 2, endColumn: 4, endOffset: 16 })
  })

  it.each([
    '  [^g]: more\n  ```\n',
    '  [^g]: more\n  :  nested\n',
    '  [^g]: more\n  [^h]: x\n',
    '  [^g]: more\n  [r]: /u\n',
    '  [^g]: more\n  :::\n',
  ])('declines or stays exact when the cut continuation line is not paragraph text: %s',
    expectExactOrDeclined)
})
