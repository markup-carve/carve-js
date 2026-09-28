import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// A `%%%` span whose OPENER is written on the item's marker line, and the closer
// column that used to decide whether the span existed at all. Every expectation
// is the oracle's (`scripts/spec/layout.mjs` into `scripts/spec/html.mjs` in
// markup-carve/carve at e24e38e9), run rather than read.
//
// PART 9 §53 gives the fence form the body and closer that travel with its
// OPENER, and CARVE-P0-013 lets a `%%%` run close the span at any column while
// ending no container - so where the closer stands is not a parameter of whether
// the span closes. The item's below-column test asked instead whether its
// COLLECTED lines hold a span open, and the marker line is not one of them, so a
// span opened there was invisible: the closer ended the item, the item's own
// parse then read an opener with no closer, and §28 degrades that to one `%%`
// line - which published the payload the author had hidden.
//
// The band strictly between two ancestors' content columns is NOT fixed here and
// has no row below: markup-carve/carve-js#2289 owns it.
describe('a comment span opened on the marker line', () => {
  it.each([
    [
      'the closer at document column closes the span the marker line opened',
      '- %%%\n  hidden\n%%%\ntail\n',
      '<ul>\n  <li></li>\n</ul>\n<p>tail</p>',
    ],
    [
      'the closer below the column reads the same as one at it',
      '- %%%\n  hidden\n  %%%\ntail\n',
      '<ul>\n  <li></li>\n</ul>\n<p>tail</p>',
    ],
    [
      'a closer in the band between zero and the column closes it too',
      '- %%%\n  hidden\n %%%\ntail\n',
      '<ul>\n  <li></li>\n</ul>\n<p>tail</p>',
    ],
    [
      'a wider span pairs on its own width',
      '- %%%%\n  hidden\n%%%%\ntail\n',
      '<ul>\n  <li></li>\n</ul>\n<p>tail</p>',
    ],
    [
      'an ordered marker line reads the same',
      '1. %%%\n   hidden\n%%%\ntail\n',
      '<ol>\n  <li></li>\n</ol>\n<p>tail</p>',
    ],
    [
      'an over-indented payload is still payload',
      '- %%%\n      hidden\n%%%\ntail\n',
      '<ul>\n  <li></li>\n</ul>\n<p>tail</p>',
    ],
    [
      'a shorter run inside the span is payload, not its closer',
      '- %%%%\n  %%%\n%%%%\ntail\n',
      '<ul>\n  <li></li>\n</ul>\n<p>tail</p>',
    ],
    // Controls. Each one passes in every state of the fix, so a change that
    // satisfies the rows above by widening the span would fail here.
    [
      'an opener with no closer is one line comment and the rest is content',
      '- %%%\n  hidden\n',
      '<ul>\n  <li>hidden</li>\n</ul>',
    ],
    [
      'a span opened below the marker line was already read this way',
      '- item\n  %%%\n  hidden\n%%%\ntail\n',
      '<ul>\n  <li>item</li>\n</ul>\n<p>tail</p>',
    ],
    [
      'the line form on the marker line opens no span',
      '- %%\n  shown\ntail\n',
      '<ul>\n  <li>shown\ntail</li>\n</ul>',
    ],
  ])('%s', (_name, source, expected) => {
    expect(carveToHtml(source).trim()).toBe(expected)
  })
})
