import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// ---------------------------------------------------------------------------
// A BAND MARKER FOLDS INTO WHAT THE ITEM STILL HOLDS OPEN, OR ENDS IT
// (markup-carve/carve-js#2338).
//
// A list marker indented past the base column but below the item's content
// column has no level of its own to open at: under symmetric §10 it does not
// interrupt a paragraph, so while the item holds one the marker folds into it as
// text. Once the item's paragraph is over - an attribute line, a reference or
// footnote definition, a heading, a closed fence - there is nothing left to fold
// into, and a line below the content column leaves the container. The oracle
// then ends the list and reads the marker as a SIBLING list at the document's
// own level.
//
// The band followers that are not markers already read that way here, which is
// what left one band answering two ways depending on how it was spelled.
//
// NOT THE SHAPE markup-carve/carve#2558 RULED. That one is a band follower after
// an INVISIBLE line, which renders nothing and leaves the item's level where it
// was; corpus category 517 pins those, and they nest. An attribute line and a
// definition each attach to something, so they are not invisible lines.
//
// Every expectation is measured against the executable spec (scripts/spec/
// layout.mjs into scripts/spec/html.mjs) at markup-carve/carve 5b70a768, which
// reproduces its own corpus 2076/2076.
// ---------------------------------------------------------------------------

const TWO_LISTS = '<ul>\n  <li>t</li>\n</ul>\n<ul>\n  <li>b</li>\n</ul>'

describe('a band marker after a block the item cannot extend', () => {
  // The four marker spellings, after the attribute line of the reported shape.
  // A reader keyed on the bullet alone would pass a single-spelling test.
  it.each([
    ['a bullet', '- t\n  {.k}\n - b\n', TWO_LISTS],
    [
      'an ordered marker',
      '- t\n  {.k}\n 1. b\n',
      '<ul>\n  <li>t</li>\n</ul>\n<ol>\n  <li>b</li>\n</ol>',
    ],
    [
      'a task marker',
      '- t\n  {.k}\n - [ ] b\n',
      '<ul>\n  <li>t</li>\n</ul>\n<ul class="task-list">\n  <li><input type="checkbox" disabled aria-label="b"> b</li>\n</ul>',
    ],
    [
      'a marker carrying an abutting attribute block',
      '- t\n  {.k}\n -{.x} b\n',
      '<ul>\n  <li>t</li>\n</ul>\n<ul>\n  <li class="x">b</li>\n</ul>',
    ],
  ])('%s starts a sibling list', (_name, source, expected) => {
    expect(carveToHtml(source)).toBe(expected)
  })

  // Every block kind that ends the item's paragraph without rendering the item
  // a level for the band to reach. The attribute line and the two definitions
  // render nothing and still end it, which is the distinction from an invisible
  // LINE below.
  it.each([
    ['an attribute line', '- t\n  {.k}\n - b\n', TWO_LISTS],
    ['a reference definition', '- t\n  [r]: /u\n - b\n', TWO_LISTS],
    ['a footnote definition', '- t\n  [^f]: n\n - b\n', TWO_LISTS],
    [
      'a heading',
      '- t\n  # h\n - b\n',
      '<ul>\n  <li>t\n    <h1 id="h">h</h1>\n  </li>\n</ul>\n<ul>\n  <li>b</li>\n</ul>',
    ],
    [
      'a closed code fence',
      '- t\n  ```\n  q\n  ```\n - b\n',
      '<ul>\n  <li>t\n    <pre><code>q\n</code></pre>\n  </li>\n</ul>\n<ul>\n  <li>b</li>\n</ul>',
    ],
  ])('after %s', (_name, source, expected) => {
    expect(carveToHtml(source)).toBe(expected)
  })

  // A blank line does not change the answer, and an ordered host reads the same
  // way as an unordered one.
  it.each([
    ['a blank line between them', '- t\n  {.k}\n\n - b\n', TWO_LISTS],
    [
      'an ordered host',
      '1. t\n   {.k}\n  - b\n',
      '<ol>\n  <li>t</li>\n</ol>\n<ul>\n  <li>b</li>\n</ul>',
    ],
  ])('with %s', (_name, source, expected) => {
    expect(carveToHtml(source)).toBe(expected)
  })
})

describe('the controls that keep the band marker folding', () => {
  // THE EXEMPTION IS STILL THERE. With the item's paragraph open, the marker
  // folds into it as text - it does not interrupt the paragraph and it does not
  // open a list. This is what a fix that simply dropped the marker clause would
  // break.
  it.each([
    ['a bullet', '- t\n - b\n', '<ul>\n  <li>t\n- b</li>\n</ul>'],
    ['an ordered marker', '1. a\n  1. b\n', '<ol>\n  <li>a\n1. b</li>\n</ol>'],
    ['an abutting attribute block', '- a\n -{.x} b\n', '<ul>\n  <li>a\n-{.x} b</li>\n</ul>'],
  ])('%s below an open paragraph folds into it', (_name, source, expected) => {
    expect(carveToHtml(source)).toBe(expected)
  })

  // Comments retain the item without relaxing child-list indentation.
  it.each([
    [
      'a line comment',
      '- t\n  %% c\n - b\n',
      '<ul>\n  <li>t\n    - b\n  </li>\n</ul>',
    ],
    [
      'a closed comment span',
      '- t\n  %%%\n  h\n  %%%\n - b\n',
      '<ul>\n  <li>t\n    - b\n  </li>\n</ul>',
    ],
  ])('a band marker after %s stays text', (_name, source, expected) => {
    expect(carveToHtml(source)).toBe(expected)
  })

  // AT the content column the attribute line attaches, which is the reading the
  // band case is measured against: the class reaching nothing above is not a
  // loss, it is §15's own level test.
  it.each([
    [
      'a bullet',
      '- t\n  {.k}\n  - b\n',
      '<ul>\n  <li>t\n    <ul class="k">\n      <li>b</li>\n    </ul>\n  </li>\n</ul>',
    ],
    [
      'a paragraph',
      '- t\n  {.k}\n  z\n',
      '<ul>\n  <li>t\n    <p class="k">z</p>\n  </li>\n</ul>',
    ],
  ])('at the content column the attribute line attaches to %s', (_name, source, expected) => {
    expect(carveToHtml(source)).toBe(expected)
  })

  // The non-marker band follower, which already left the item before this
  // change: the two spellings of one band now agree.
  it('a band paragraph after an attribute line still leaves the item', () => {
    expect(carveToHtml('- t\n  {.k}\n z\n')).toBe('<ul>\n  <li>t</li>\n</ul>\n<p>z</p>')
  })
})
