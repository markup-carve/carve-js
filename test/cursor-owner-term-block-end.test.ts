import { describe, expect, it } from 'vitest'

import { parse } from '../src/index.js'
import { parseCursorPrototype } from '../src/parse/cursor-prototype.js'

describe('cursor owner reconciliation: a block start below the term column ends the list', () => {
  it.each([
    '> :: c\n>   # H\n',
    '> :: c\n>   # H\n>   body\n',
    '> ::   c\n>     # H\n',
    '> :: c\n>   > q\n',
    '> :: c\n>   ```\n',
  ])('matches the reference inside a quote: %s', (source) => {
    expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
  })

  it.each(['---', '***', '___', '- - -'])('ends a description at a bounded %s line', (marker) => {
    for (const source of [`:: t\n: para\n ${marker}\n`, `> :: t\n> : para\n>  ${marker}\n`]) {
      expect(parseCursorPrototype(source)).toStrictEqual(parse(source))
    }
  })
})
