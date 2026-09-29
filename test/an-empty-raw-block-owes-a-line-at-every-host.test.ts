import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

/**
 * An html `raw_block` with no payload lines renders `pad + ''`. The block-list
 * join dropped a child whose rendering was `''`, so at pad level 0 the block
 * vanished while one level in - a quote, an item, a heading's `<section>` - the
 * pad itself kept it alive. `raw_block`'s AN ALL-BLANK PAYLOAD IS NOT AN ABSENT
 * BLOCK names no host and no depth, and the oracle, carve-php and carve-rs all
 * emit the line at the root (markup-carve/carve-js#2326).
 *
 * The one-blank-line payload is a separate disagreement, and this engine is on
 * the clause's side of it (markup-carve/carve#2557); nothing here moves it.
 */
describe('an empty raw block owes a line at every host', () => {
  it.each([
    ['three backticks', 'a\n\n```=html\n```\n\nb\n'],
    ['four backticks', 'a\n\n````=html\n````\n\nb\n'],
    ['three tildes', 'a\n\n~~~=html\n~~~\n\nb\n'],
    ['four tildes', 'a\n\n~~~~=html\n~~~~\n\nb\n'],
  ])('%s at the document root', (_name, source) => {
    expect(carveToHtml(source)).toBe('<p>a</p>\n\n<p>b</p>')
  })

  it('escaping the payload does not remove the line', () => {
    expect(carveToHtml('a\n\n```=html\n```\n\nb\n', { allowRawHtml: false })).toBe(
      '<p>a</p>\n\n<p>b</p>',
    )
  })

  it('opens the document with its line', () => {
    expect(carveToHtml('```=html\n```\n\nb\n')).toBe('\n<p>b</p>')
  })

  /**
   * BOUNDS. Each already held before the fix, so none of them proves it. They
   * pin the two things it must not change: the hosts that were already right,
   * and the blocks that render nothing BY DESIGN and owe no line.
   */
  describe('unchanged', () => {
    it.each([
      ['a heading section', '# h\n\na\n\n```=html\n```\n\nb\n', '<section id="h">\n  <h1>h</h1>\n  <p>a</p>\n  \n  <p>b</p>\n</section>'],
      ['a block quote', '> a\n>\n> ```=html\n> ```\n>\n> b\n', '<blockquote>\n  <p>a</p>\n  \n  <p>b</p>\n</blockquote>'],
      ['a list item', '- a\n\n  ```=html\n  ```\n\n- b\n', '<ul>\n  <li><p>a</p>\n    \n  </li>\n  <li><p>b</p></li>\n</ul>'],
    ])('%s keeps the line it already had', (_name, source, expected) => {
      expect(carveToHtml(source)).toBe(expected)
    })

    it.each([
      ['a comment', 'a\n\n%% c\n\nb\n'],
      ['an abbreviation definition', 'a\n\n*[HT]: Hyper Text\n\nb\n'],
      ['a raw block the target drops', 'a\n\n```=latex\n```\n\nb\n'],
    ])('%s still owes no line', (_name, source) => {
      expect(carveToHtml(source)).toBe('<p>a</p>\n<p>b</p>')
    })
  })
})
