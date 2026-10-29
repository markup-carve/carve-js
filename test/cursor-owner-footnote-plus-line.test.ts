import { describe, expect, it } from 'vitest'
import { parse } from '../src/index.js'
import { parseCursorPrototype, UnsupportedCursorSyntax } from '../src/parse/cursor-prototype.js'

function expectExactOrDeclined(source: string): void {
  let candidate: ReturnType<typeof parseCursorPrototype>
  try {
    candidate = parseCursorPrototype(source)
  } catch (error) {
    if (error instanceof UnsupportedCursorSyntax) return
    throw error
  }
  expect(candidate, source).toStrictEqual(parse(source))
}

describe('footnote paragraph followed by a lone plus line', () => {
  it.each([
    '[^f]: note\n+\n:::\n',
    '[^f]: note\n+\n    b\n',
    '[^f]: note\n+\n::: note\n',
    '  [^g]: more\n+\n    - d\n',
    '  [^g]: more\n+\n%% c\n',
  ])('keeps exact or declines %j', expectExactOrDeclined)

  it('declines the plus line the footnote paragraph absorbs', () => {
    expect(() => parseCursorPrototype('[^f]: note\n+\n:::\n')).toThrow(UnsupportedCursorSyntax)
  })

  it('still attaches a plain line after the plus line', () => {
    const source = '[^f]: note\n+\nplain\n'
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })
})
