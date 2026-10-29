import { describe, expect, it } from 'vitest'

import { parse } from '../src/index.js'
import { parseCursorPrototype, UnsupportedCursorSyntax } from '../src/parse/cursor-prototype.js'

describe('cursor owner reconciliation: a below-column comment ends a description', () => {
  it.each([
    ':: t\n:  x\n%% c\nz\n',
    ':: t\n:  x\n %% c\n  z\n',
    ':: t\n:   x\n  %% c\n   z\n',
    ':: t\n:  x\n %% c\n\nz\n',
    ':: t\n:  d\n  %% c\n',
    ':: t\n:  d\n  %% c\nend\n',
    '> :: t\n> :  d\n>   %% c\n',
    ':: t\n:  x\n%% c\n- item\n',
    ':: t\n:  x\n%% c\n# H\n',
  ])('is exact: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each([
    ':  meaning\n%% c\n# Heading\n',
    '[^a]: intro\n%% c\n  more\n',
  ])('still declines without a term or in a note: %s', (source) => {
    expect(() => parseCursorPrototype(source)).toThrow(UnsupportedCursorSyntax)
  })
})
