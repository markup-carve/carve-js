import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * PART 1 S4: NO OPEN PARAGRAPH, NO LAZY LINE, asked of the block a container's
 * MARKER LINE holds.
 *
 * S4 was pinned for an empty quote (`- >`), which reads as though EMPTINESS were
 * the property doing the work. It is not. The parameter is whether a paragraph
 * is OPEN, and a block that leaves none leaves none wherever it was written - so
 * `- # H` puts a heading in the item exactly as `- ` plus an indented `# H`
 * would, and the flush-left line below it is the document's, not the item's
 * (markup-carve/carve#1280, corpus category 326).
 *
 * The seeding this covers asked only "blank, or an empty quote?", so SEVEN other
 * paragraph-less shapes read as an open paragraph and swallowed the line below
 * them - every one of which this same engine already ended on in a block quote
 * (`> # H` / `tail`). One rule stated for one container and not the other.
 *
 * carve-rs `b6ff319c` produces every expectation below.
 */
describe('a marker-line block that leaves no paragraph open ends the item', () => {
  const cases: Array<[string, string, string]> = [
    ['a heading', '- # H\ntail\n', '<ul>\n  <li>\n    <h1 id="H">H</h1>\n  </li>\n</ul>\n<p>tail</p>'],
    [
      'a table',
      '- | a | b |\ntail\n',
      '<ul>\n  <li>\n    <table>\n      <tbody>\n        <tr><td>a</td><td>b</td></tr>\n      </tbody>\n    </table>\n  </li>\n</ul>\n<p>tail</p>',
    ],
    ['a thematic break', '- ---\ntail\n', '<ul>\n  <li>\n    <hr>\n  </li>\n</ul>\n<p>tail</p>'],
    ['a line comment', '- %% c\ntail\n', '<ul>\n  <li></li>\n</ul>\n<p>tail</p>'],
    ['an attribute block', '- {.k}\ntail\n', '<ul>\n  <li></li>\n</ul>\n<p>tail</p>'],
  ]

  for (const [name, source, expected] of cases) {
    it(`${name} ends it`, () => {
      expect(carveToHtml(source)).toBe(expected)
    })
  }

  it('a link reference definition ends it, and still defines', () => {
    // Ending the item disposes of the line BELOW it, never of the definition
    // itself - §17 L6 collects that from wherever it was written.
    expect(carveToHtml('- [r]: /u\ntail\n\n[r][]\n')).toBe(
      '<ul>\n  <li></li>\n</ul>\n<p>tail</p>\n<p><a href="/u">r</a></p>',
    )
  })

  it('a footnote definition ends it, and still defines', () => {
    expect(carveToHtml('- [^f]: t\ntail\n\nsee[^f]\n')).toContain(
      '<ul>\n  <li></li>\n</ul>\n<p>tail</p>',
    )
    expect(carveToHtml('- [^f]: t\ntail\n\nsee[^f]\n')).toContain('role="doc-endnotes"')
  })

  it('a comment fence takes its body from the content column and nowhere else', () => {
    // The closer travels with the opener, and what follows the closer is outside
    // the item. Reading the column-0 lines as the comment's body published an
    // empty item and DELETED them.
    expect(carveToHtml('- %%%\nc\n%%%\ntail\n')).toBe(
      '<ul>\n  <li></li>\n</ul>\n<p>c</p>\n<p>tail</p>',
    )
  })

  it('the question is asked of a quote recursively', () => {
    expect(carveToHtml('- > # H\ntail\n')).toBe(
      '<ul>\n  <li>\n    <blockquote>\n      <h1 id="H">H</h1>\n    </blockquote>\n  </li>\n</ul>\n<p>tail</p>',
    )
  })

  it('the container kind is not a parameter: a definition body answers the same', () => {
    // carve#920. The `:  ` marker is the third indented-block collector and S4
    // is one rule, so a heading written on it ends the description exactly as it
    // ends an item.
    expect(carveToHtml(':: t\n:  # h\ntail\n')).toBe(
      '<dl>\n  <dt>t</dt>\n  <dd>\n    <h1 id="h">h</h1>\n  </dd>\n</dl>\n<p>tail</p>',
    )
    expect(carveToHtml(':: t\n:  {.k}\ntail\n')).toBe(
      '<dl>\n  <dt>t</dt>\n  <dd></dd>\n</dl>\n<p>tail</p>',
    )
  })

  it('a sibling marker after the same shape still opens a sibling', () => {
    // The control for "the item ended" rather than "the item swallowed
    // something": without it, a reader that ended the LIST would pass every row
    // above.
    expect(carveToHtml('- # H\n- next\n')).toBe(
      '<ul>\n  <li>\n    <h1 id="H">H</h1>\n  </li>\n  <li>next</li>\n</ul>',
    )
  })

  // The other value of the one parameter. A reader that ended the item on every
  // marker-line block would pass every row above and fail these.
  it('a quote holding a paragraph still folds', () => {
    expect(carveToHtml('- > q\ntail\n')).toBe(
      '<ul>\n  <li>\n    <blockquote><p>q\ntail</p></blockquote>\n  </li>\n</ul>',
    )
  })

  it('plain lead text is the ordinary lazy continuation, untouched', () => {
    expect(carveToHtml('- a\ntail\n')).toBe('<ul>\n  <li>a\ntail</li>\n</ul>')
  })

  it('a brace line that is not an attribute line still holds a paragraph', () => {
    // `{1a}` is a digit-first identifier, so §15 A6 leaves the block literal and
    // it is paragraph text. The predicate has to be the attribute parser, not
    // "starts with a brace".
    expect(carveToHtml('- {1a}\ntail\n')).toBe('<ul>\n  <li>{1a}\ntail</li>\n</ul>')
  })

  it('only the marker line: a collected heading still folds', () => {
    // Corpus 75-list-nesting-and-looseness-4. S4 leaves this half deliberately
    // open and the corpus pins the FOLDING answer for it, so the rule above is
    // gated on the marker line rather than on the heading.
    expect(carveToHtml('- a\n  - b\n    # N\nlazy\n')).toBe(
      '<ul>\n  <li>a\n    <ul>\n      <li>b\n        <h1 id="N">N</h1>\n        lazy\n      </li>\n    </ul>\n  </li>\n</ul>',
    )
  })

  it('a marker line holding a marker line is unwrapped too', () => {
    // `- - # H` writes the heading as the SUB-item's first block, so the same
    // question is asked of it - the helper unwraps the marker rather than
    // reading `- # H` as prose. carve-rs `b6ff319c` produces this.
    expect(carveToHtml('- - # H\ntail\n')).toBe(
      '<ul>\n  <li>\n    <ul>\n      <li>\n        <h1 id="H">H</h1>\n      </li>\n    </ul>\n  </li>\n</ul>\n<p>tail</p>',
    )
    // The control: unwrapping must not make every nested marker close.
    expect(carveToHtml('- - a\ntail\n')).toBe(
      '<ul>\n  <li>\n    <ul>\n      <li>a\ntail</li>\n    </ul>\n  </li>\n</ul>',
    )
  })

  it('what is left after the quote marker is read at column 0', () => {
    // A quote marker takes exactly ONE following space, so `>  [r]: /u` leaves an
    // INDENTED line inside the quote - and §24 C3 makes that paragraph text, not
    // a definition. Three classifiers here match a leading `[ \t]*` run and would
    // otherwise answer for a construct the block parser never builds, ending an
    // item that does hold an open paragraph.
    expect(carveToHtml('- >  [r]: /u\ntail\n')).toBe(
      '<ul>\n  <li>\n    <blockquote><p>[r]: /u</p></blockquote>\n    tail\n  </li>\n</ul>',
    )
    // The flush spelling is the definition, and it does end the item.
    expect(carveToHtml('- > [r]: /u\ntail\n')).toBe(
      '<ul>\n  <li>\n    <blockquote>\n\n    </blockquote>\n  </li>\n</ul>\n<p>tail</p>',
    )
  })

  it('a nested marker line is a marker line', () => {
    // The sub-item's first block is the heading, so nothing in the open stack
    // holds a paragraph and the line reaches no container.
    expect(carveToHtml('- a\n  - # N\nlazy\n')).toBe(
      '<ul>\n  <li>a\n    <ul>\n      <li>\n        <h1 id="N">N</h1>\n      </li>\n    </ul>\n  </li>\n</ul>\n<p>lazy</p>',
    )
  })
})
