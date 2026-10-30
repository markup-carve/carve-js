import { describe, expect, it } from 'vitest'
import { lintCarve } from '../src/lint.js'

const refused = (source: string) =>
  lintCarve(source).filter(w => w.rule === 'continuation-marker-refused').map(w => [w.line, w.column])

// A `> +` at an outer quote level attaches a deeper-quoted follower at its column,
// and that attached quote nests (PART 9 §17 L4, corpus 646-8).
describe('an outer-level quote plus before a deeper quote line', () => {
  it.each([
    '> > q\n> +\n> > r\n',
    '> > q\n> +\n> > > r\n',
    '> > > q\n> > +\n> > > r\n',
    '- > > q\n  > +\n  > > r\n',
  ])('%j is silent', (source) => {
    expect(refused(source)).toEqual([])
  })

  it.each([
    ['> > q\n> +\n\n', 2, 3],
    ['> > q\n> +\n>  > r\n', 2, 3],
  ])('%j is still reported', (source, line, column) => {
    expect(refused(source)).toEqual([[line, column]])
  })
})
