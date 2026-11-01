import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const compact = (source: string): string => carveToHtml(source).replace(/>\s+</g, '><').trim()

// carve#4728, CARVE-P9-014: blanks around a comment are one run, so three end the list at every level.
describe('the blank run around a comment', () => {
  it.each([
    ['two before, one after', '- a\n\n\n%% c\n\n- b\n'],
    ['one before, two after', '- a\n\n%% c\n\n\n- b\n'],
    ['split by two comments', '- a\n\n%% c\n\n%% d\n\n- b\n'],
    ['ordered', '1. a\n\n\n%% c\n\n2. b\n'],
    ['in a quote', '> - a\n>\n>\n> %% c\n>\n> - b\n'],
  ])('ends the list: %s', (_name, source) => {
    expect((compact(source).match(/<[uo]l/g) ?? []).length).toBe(2)
  })

  it('in a nested list', () => {
    expect(compact('- o\n  - a\n\n\n  %% c\n\n  - b\n')).toBe('<ul><li>o\n    <ul><li>a</li></ul><ul><li>b</li></ul></li></ul>')
  })

  it('one blank on each side stays one loose list', () => {
    expect(compact('- a\n\n%% c\n\n- b\n')).toBe('<ul><li><p>a</p></li><li><p>b</p></li></ul>')
  })
})

// carve#4752, PART 0 S1: an open span tests its closer before ownership.
describe('a comment span in a quote with an unmarked closer', () => {
  it.each([
    ['closer alone', '> %%%\n> secret\n%%%\n', '<blockquote></blockquote>'],
    ['the quote goes on', '> %%%\n> secret\n%%%\n> more\n', '<blockquote><p>more</p></blockquote>'],
    ['an indented closer', '> %%%\n> secret\n  %%%\nafter\n', '<blockquote></blockquote><p>after</p>'],
    ['a closer with a tail', '> %%%\n> secret\n%%% x\n', '<blockquote></blockquote>'],
    ['a nested quote', '> > %%%\n> > secret\n%%%\n> more\n', '<blockquote><blockquote></blockquote><p>more</p></blockquote>'],
    ['a closer short of the depth', '> > %%%\n> > secret\n> %%%\n> more\n', '<blockquote><blockquote></blockquote><p>more</p></blockquote>'],
    ['in an item', '- > %%%\n  > secret\n  %%%\n  > more\n', '<ul><li><blockquote><p>more</p></blockquote></li></ul>'],
  ])('closes the span: %s', (_name, source, html) => {
    expect(compact(source)).toBe(html)
  })

  it.each([
    ['another width', '> %%%\n> secret\n%%%%\n', '<blockquote><p>secret</p></blockquote>'],
    ['past a blank', '> %%%\n> secret\n\n%%%\n', '<blockquote><p>secret</p></blockquote>'],
    ['past an unmarked line', '> %%%\n> secret\nfoo\n> %%%\n', '<blockquote><p>secret</p></blockquote><p>foo</p><blockquote></blockquote>'],
    ['below the item', '- > %%%\n  > secret\n%%%\n', '<ul><li><blockquote><p>secret</p></blockquote></li></ul>'],
  ])('leaves the span unclosed: %s', (_name, source, html) => {
    expect(compact(source)).toBe(html)
  })
})
