import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const compact = (source: string): string => carveToHtml(source).replace(/>\s+</g, '><').trim()

// carve-js#4386, PART 0 S1: an erased line keeps its `>` prefix, which is the quote's blank line.
describe('an erased line in a quoted list item', () => {
  it.each([
    ['comment at the item column', '> - a\n>   %% n\n>   x\n'],
    ['comment at the quote column', '> - a\n> %% n\n>   x\n'],
    ['empty comment', '> - a\n>   %%\n>   x\n'],
    ['link definition', '> - a\n>   [x]: /u\n>   x\n'],
    ['ordered item', '> 1. a\n>    %% n\n>    x\n'],
  ])('separates two paragraphs: %s', (_name, source) => {
    expect(compact(source)).toMatch(/<li><p>a<\/p><p>x<\/p><\/li>/)
  })

  it('in a nested quote', () => {
    expect(compact('> > - a\n> >   %% n\n> >   x\n'))
      .toBe('<blockquote><blockquote><ul><li><p>a</p><p>x</p></li></ul></blockquote></blockquote>')
  })

  it('leaves the unquoted item tight', () => {
    expect(compact('- a\n  %% n\n  x\n')).toBe('<ul><li>a\nx</li></ul>')
  })
})
