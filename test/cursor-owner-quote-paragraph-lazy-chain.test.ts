import { describe, expect, it } from 'vitest'

import { parse } from '../src/index.js'
import { parseCursorPrototype, UnsupportedCursorSyntax } from '../src/parse/cursor-prototype.js'

describe('cursor lazy chain owned by a quote paragraph', () => {
  it.each([
    '> q\n  - c\n    b\n',
    '> q\n    - d\n  :  nested\n',
    '> q\n- b\n:  meaning\n',
    '> > deep\n- a\n    b\n',
    '> > deep\n1. one\n    b\n',
    '> q\ntail\n- a\n  - c\n',
    '> q\ntail\n- a\n  - c\n+\n',
  ])('keeps every walk-lazy line in the quote paragraph with full AST and positions: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each([
    '> > deep\n- b\n    - d\n+\n',
  ])('declines a plus marker that follows a chained lazy run: %s', (source) => {
    expect(() => parseCursorPrototype(source)).toThrow(UnsupportedCursorSyntax)
  })

  it.each([
    '> > deep\n1. one\n~~~\n',
    '> > deep\n1. one\n~~~\n  ::: note\n  ~~~\n',
  ])('leaves a lazy fence opener to its closer lookahead: %s', (source) => {
    try {
      expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
    } catch (error) {
      expect(error).toBeInstanceOf(UnsupportedCursorSyntax)
    }
  })
})
