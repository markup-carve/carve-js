import { describe, expect, it } from 'vitest'
import { lintCarve } from '../src/lint.js'

const refused = (source: string) =>
  lintCarve(source).filter(w => w.rule === 'continuation-marker-refused').map(w => `${w.line}:${w.column}`)

// A `+` behind quote prefixes that a host's indentation spaces apart is measured through
// them, so a list at its quote's column attaches silently (markup-carve/carve#4409).
describe('a plus behind spaced quote prefixes', () => {
  it('is silent in a quote first-block host', () => {
    expect(refused('> - > q\n>   > > +\n>   > - s\n')).toEqual([])
  })

  it('is silent one quote level deeper', () => {
    expect(refused('> > - > q\n> >   > > +\n> >   > - s\n')).toEqual([])
  })
})
