import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

// A blank `>` line inside a quoted item does not close the item, so a `+`
// at a nested item's marker column below it still finds its owner.
const html = (src: string): string => carveToHtml(src).replace(/\n\s*/g, '')

describe('a blank quoted line before a plus', () => {
  it.each([
    ['paragraph follower', '- > - a\n  >   - b\n  >\n  >   +\n  >   b\n'],
    ['quote follower', '- > - a\n  >   - b\n  >\n  >   +\n  >   > r\n'],
    ['heading follower', '- > - a\n  >   - b\n  >\n  >   +\n  >   # h\n'],
    ['top-level quote', '> - a\n>   - b\n>\n>   +\n>   b\n'],
  ])('loosens the outer item: %s', (_name, src) => {
    expect(html(src)).toContain('<li><p>a</p>')
  })

  it('reads a plus before a sibling marker as text', () => {
    expect(html('- > - a\n  >   - b\n  >\n  >   +\n  >   - s\n')).toBe(
      '<ul><li><blockquote><ul><li><p>a</p><ul><li>b</li></ul><p>+</p><ul><li>s</li></ul></li></ul></blockquote></li></ul>')
  })

  it('lets a deeper blank quote own the plus', () => {
    expect(html('- > - a\n  > >\n  > +\n  > - s\n')).toBe(
      '<ul><li><blockquote><ul><li>a</li></ul><blockquote><ul><li>s</li></ul></blockquote></blockquote></li></ul>')
  })
})
