import { describe, expect, it } from 'vitest'

import { parse } from '../src/index.js'
import { ownLines } from '../src/parse/block/block-ownership.js'
import { parseCursorPrototype, UnsupportedCursorSyntax } from '../src/parse/cursor-prototype.js'

describe('ownLines line events', () => {
  it('records the lazy marker line with its owner, missed frames and quote depth', () => {
    const owned = ownLines(['> > deep', '> - x', '> - x'])
    expect([...owned.events.values()]).toStrictEqual([
      { at: 1, kind: 'item', sourceCol: 0, ownedCol: 0, marker: { axes: '-', width: 2, head: 2 },
        reached: 'quote', missed: ['quote'], lazy: true, quoteDepth: 1 },
      { at: 2, kind: 'item', sourceCol: 0, ownedCol: 0, marker: { axes: '-', width: 2, head: 2 },
        reached: 'quote', missed: ['quote'], lazy: true, quoteDepth: 1 },
    ])
  })

  it('records no event for a line the walk owns', () => {
    expect(ownLines(['> q', '> - x']).events.size).toBe(0)
  })
})

describe('cursor reads a list marker the walk kept in a nested quote paragraph', () => {
  it.each([
    '> > deep\n> - x\n> - x\n',
    '> - x\n> > deep\n- b\n',
    '> - x\n> > deep\n- a\n- b\n',
    '> - x\n> > deep\n- a\n1. one\n\n',
  ])('matches parse() with full AST and positions: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it('declines a plus marker that closes the nested quote the lazy line sat in', () => {
    expect(() => parseCursorPrototype('> - x\n> > deep\n- a\n+\n%% c\n')).toThrow(UnsupportedCursorSyntax)
  })
})
