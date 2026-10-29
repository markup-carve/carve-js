import { describe, expect, it } from 'vitest'
import { lintCarve } from '../src/lint.js'

const refused = (source: string) =>
  lintCarve(source).filter(w => w.rule === 'continuation-marker-refused').map(w => `${w.line}:${w.column}`)

// A wrong-column `+` behind quote prefixes that a host's indentation spaces apart
// is still a lone marker in the source, as in carve-php and carve-rs (carve-js#3863).
describe('a refused plus behind spaced quote prefixes', () => {
  it('is reported in a quote first-block host', () => {
    expect(refused('> - > q\n>   > > +\n>   > - s\n')).toEqual(['2:9'])
  })

  it('is reported one quote level deeper', () => {
    expect(refused('> > - > q\n> >   > > +\n> >   > - s\n')).toEqual(['2:11'])
  })
})
