import { describe, expect, it } from 'vitest'

import { parse } from '../src/index.js'
import { parseCursorPrototype, UnsupportedCursorSyntax } from '../src/parse/cursor-prototype.js'

describe('cursor footnote paragraph inside a root-level colon container', () => {
  it.each([
    '::: note\n[^f]: note\ntail\n',
    '::: note\n[^f]: note\n- a\n',
    '::: note\n[^f]: note\n1. one\n',
    '  ::: note\n  [^g]: more\ntext\n',
    '::: note\n[^f]: note\ntail\n:::\nafter\n',
  ])('keeps the flush-left lazy line in the note: %s', (source) => {
    let actual: ReturnType<typeof parseCursorPrototype>
    try {
      actual = parseCursorPrototype(source)
    } catch (error) {
      if (error instanceof UnsupportedCursorSyntax) return
      throw error
    }
    expect(actual, source).toStrictEqual(parse(source))
  })

  it('accepts the plain lazy line instead of declining', () => {
    const source = '::: note\n[^f]: note\ntail\n'
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })
})
