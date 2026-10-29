import { describe, expect, it } from 'vitest'

import { parse } from '../src/index.js'
import { parseCursorPrototype, UnsupportedCursorSyntax } from '../src/parse/cursor-prototype.js'

describe('cursor lazy line owned by a quoted list paragraph', () => {
  it.each([
    '> - Be skeptical.\n> - Be kind.\n^ House rules\n',
    '- > - x\n  - m\n',
    '- a\n  > - x\n  p\n  - m\n',
    '> - x\n  +\n',
    '> - intro\n> tail\n',
    '> * x\n  plain\n',
    '> - +\n> p\n',
  ])('is exact when the walk names only a quote and an item: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each([
    '> - x\n x\n',
    '> - x\n    - d\n',
    '%% c\n:::\n> - x\n    - d\n',
    '> > - x\nx\n',
    '- a\n  [^f]: t\ntail\n\nx[^f]\n',
  ])('declines when the owner is not a flush-left quote-list lazy line: %s', (source) => {
    try {
      expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
    } catch (error) {
      expect(error).toBeInstanceOf(UnsupportedCursorSyntax)
    }
  })

  it.each([
    '> q\n    - d\n    - d\n',
    '> q\n    - d\n  - c\n',
    '> q\n    - d\n    - d\n  [^g]: more\n    b\n  - c\n',
  ])('declines chained indented list-marker lazy lines under a quote paragraph: %s', (source) => {
    expect(() => parseCursorPrototype(source)).toThrow(UnsupportedCursorSyntax)
  })

  it.each([
    '> q\n    - d\n',
    '> > deep\n- b\n- b\n',
  ])('keeps the single or nested lazy line admission exact: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })
})
