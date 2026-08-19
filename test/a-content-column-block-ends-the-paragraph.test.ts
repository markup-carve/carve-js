import { describe, it, expect } from 'vitest'
import { parse, carveToHtml } from '../src/index.js'

/**
 * `markup-carve/carve#1364`, with `#1348`, `#1349`, `#1357` and `#1363`: at a
 * container's content column a line is read as a BLOCK, and a block ends the
 * paragraph it sits under. WHAT IT RENDERS IS NOT A PARAMETER, so an invisible
 * line ends it exactly as a visible one does - and the container itself ends
 * because the following line is at document column 0.
 *
 * Read from the other side that is the invariant the family reduces to: a table
 * row and a definition line are not paragraph content, so neither leaves an open
 * paragraph for a column-0 line to continue lazily.
 *
 * Eight documents across corpus categories 349, 350, 355, 356 and 357 diverged
 * on it, and two more (`358`, `359-2`) are the controls that catch a reading
 * that goes too wide.
 */

const html = (src: string): string => carveToHtml(src)

/**
 * Did `tail` come out at DOCUMENT LEVEL?
 *
 * Read as the last two lines rather than as a pattern over the whole render,
 * because a pattern cannot fail here: every one of these documents contains a
 * container closer immediately followed by `<p>tail</p>` whichever way it
 * parses - when `tail` is wrongly swallowed, the INNER closer is the one
 * followed by it. Only the outermost container's closing tag is written at
 * column 0, so that is what this reads.
 */
const tailIsTopLevel = (src: string): boolean => {
  const lines = html(src).split('\n')

  return lines.at(-1) === '<p>tail</p>' && /^<\/[a-z]+>$/.test(lines.at(-2) ?? '')
}

describe('a block at a container content column ends the paragraph', () => {
  /**
   * THE PLAINEST SPELLING, and the one the whole family reduces to. No quote,
   * no table, no continuation row: an invisible line at the item's content
   * column, and a column-0 line under it.
   */
  it('ends the item on a comment at the content column', () => {
    expect(html('- a\n  %% c\ntail\n')).toBe('<ul>\n  <li>a</li>\n</ul>\n<p>tail</p>')
    expect(tailIsTopLevel('- a\n  %% c\ntail\n')).toBe(true)
  })

  /**
   * THE FIRST CONTROL, and the one that separates the two halves of the ruling.
   * The comment ENDS THE PARAGRAPH, not the container - so a line still indented
   * belongs to the item and starts a paragraph of its own there. Only document
   * column 0 ends the container.
   */
  it('keeps the item on the same comment when the line below is indented', () => {
    expect(html('- a\n  %% c\n b\n')).toBe('<ul>\n  <li>a\n    b\n  </li>\n</ul>')
  })

  it('adds no block for a comment written BELOW the content column', () => {
    // One column in, the comment is a lazy continuation and adds no block at
    // all, so the paragraph it folded into is still open behind it.
    expect(html('- a\n %% c\ntail\n')).toBe('<ul>\n  <li>a\n    tail\n  </li>\n</ul>')
  })

  const invisible: Record<string, string> = {
    'a comment': '  %% c',
    'a comment fence': '  %%% c\n  %%%',
    'a link reference definition': '  [r]: /u',
    'a footnote definition': '  [^f]: t',
  }

  for (const [label, block] of Object.entries(invisible)) {
    it(`ends the item on ${label}`, () => {
      expect(tailIsTopLevel(`- a\n${block}\ntail\n`)).toBe(true)
    })
  }

  /**
   * A CLOSED COMMENT FENCE IS A CLOSED BLOCK. The tracker used to save the fold
   * state at the opener and restore it at the closer, on the reading that a
   * comment never changes the item's state. At the content column it does: the
   * paragraph it interrupted is over and does not come back.
   */
  it('does not give the paragraph back when a content-column comment fence closes', () => {
    expect(html('- a\n  %%% c\n  %%%\ntail\n')).toBe('<ul>\n  <li>a</li>\n</ul>\n<p>tail</p>')
  })

  it('does give it back when the fence sat below the column', () => {
    expect(html('- a\n %%% c\n %%%\ntail\n')).not.toContain('<p>tail</p>')
  })

  it('keeps the item collecting after a content-column comment fence closes', () => {
    // The other half of the same closer: the fence ended the PARAGRAPH, so an
    // indented line below it is a block of the item's own rather than the top
    // level's. Without it the item ends at the closer and `# h` becomes a
    // document heading (corpus 277-3).
    expect(html('- a\n  %%%\n  x\n  %%%\n # h\n')).toBe(
      '<ul>\n  <li>a\n    # h\n  </li>\n</ul>',
    )
  })

  /**
   * A TABLE IS A TABLE HOWEVER ITS LAST ROW IS SPELLED (`#1348`). A continuation
   * row carries no leading pipe, so the row test never saw it and a container
   * whose table ended on one reported an open paragraph its table did not have.
   */
  const tables: Record<string, string> = {
    'in a list item': '- | a |\n  + b |\ntail\n',
    'in a block quote': '> | a |\n> + b |\ntail\n',
    'in a definition body': ':: t\n:  | a |\n   + b |\ntail\n',
    'in a quote inside a definition body': ':: t\n:  > | a |\n   > + b |\ntail\n',
    'on a joined header row': '- |=a |\n  + b |\ntail\n',
    'on an empty continuation row': '- | a |\n  + |\ntail\n',
  }

  for (const [label, src] of Object.entries(tables)) {
    it(`ends the container on a continuation row ${label}`, () => {
      expect(tailIsTopLevel(src)).toBe(true)
    })
  }

  /**
   * THE SECOND CONTROL: ONLY WHERE A TABLE IS ABOVE IT (`#1349`). With no row
   * above, `+ b |` is prose and the paragraph it belongs to stays open, so a
   * dedented line still folds in. A fix that reads every `+ … |` as a row breaks
   * exactly here.
   */
  it('reads a continuation row outside the quote that holds the table as prose', () => {
    // The table is INSIDE the quote and `+ b |` is written at the container's
    // own column, so the block above it at THAT level is a blockquote and there
    // is no row for it to join - which is why neither engine merges it into the
    // table. It renders as prose here and the container keeps its paragraph.
    //
    // DIVERGENCE, uncovered by the corpus: carve-php `925f7dc` renders the same
    // prose and then ends the container anyway, reading "a table above it" past
    // the quote boundary. Filed for a ruling rather than matched, because
    // reading one line as prose and as a table row in the same breath is the
    // half that cannot be right.
    expect(tailIsTopLevel(':: t\n:  > | a |\n   + b |\ntail\n')).toBe(false)
    expect(tailIsTopLevel('- > | a |\n  + b |\ntail\n')).toBe(false)
  })

  it('reads a continuation row with no table above it as prose', () => {
    expect(tailIsTopLevel('- a\n  + b |\ntail\n')).toBe(false)
    expect(tailIsTopLevel('> a\n> + b |\ntail\n')).toBe(false)
  })

  /**
   * A QUOTE INSIDE A QUOTE IS ASKED WHAT IT ENDS ON (`#1357`). S4 is about the
   * open STACK, and the block at the bottom of it may be several quotes down.
   */
  const nested: Record<string, string> = {
    'a heading two deep': '> > # H\ntail\n',
    'a heading three deep': '> > > # H\ntail\n',
    'a heading after quoted prose': '> a\n> > # H\ntail\n',
    'a thematic break': '> > ---\ntail\n',
    'a reference definition': '> > [r]: /u\ntail\n',
    'a table spanning two lines': '> > | a |\n> > | b |\ntail\n',
    'a table ending on a continuation row': '> > | a |\n> > + b |\ntail\n',
  }

  for (const [label, src] of Object.entries(nested)) {
    it(`ends the outer quote on ${label}`, () => {
      expect(tailIsTopLevel(src)).toBe(true)
    })
  }

  it('keeps the outer quote when the inner one ends on prose', () => {
    // The intended survivor for the descent: a nested quote that DOES hold a
    // paragraph still folds the line below it.
    expect(tailIsTopLevel('> > q\ntail\n')).toBe(false)
  })

  /**
   * A FOOTNOTE DEFINITION'S BLOCK RUNS TO THE END OF ITS BODY, blank lines and
   * all (`#1363`). Its continuation lines are the definition's, not the
   * container's, so none of them reopens a paragraph and the blank between them
   * does not loosen the item either.
   */
  it('runs a footnote body past a blank line without reopening the item', () => {
    expect(html('- a\n  [^f]: t\n\n    more\ntail\n\nx[^f]\n')).toContain(
      '<ul>\n  <li>a</li>\n</ul>\n<p>tail</p>',
    )
  })

  it('ends the footnote body at the body column, not at any indent', () => {
    // `   more` is one column short of the definition's body column, so it is
    // the ITEM's prose rather than the definition's - and prose leaves an open
    // paragraph, which `tail` continues. Reading any indent as body kept the
    // run open and ended the item instead.
    //
    // DIVERGENCE, uncovered by the corpus: carve-php `925f7dc` ends the item
    // here. It renders `more` inside the item exactly as this does, so it has
    // the line as the item's prose and still declines the fold - which is the
    // half that cannot be right. `parseFootnoteDef`'s own boundary is what this
    // follows.
    expect(carveToHtml('- a\n  [^f]: t\n   more\ntail\n\nx[^f]\n')).toContain(
      '<li>a\n    more\ntail\n  </li>',
    )
  })

  /**
   * THE THIRD CONTROL, and the one an over-wide fix breaks: a LINK reference
   * definition has no body, so it opens no run. The blank after it really does
   * separate two paragraphs, and the item is loose.
   */
  it('opens no body run for a link reference definition', () => {
    expect(html('- a\n  [r]: /u\n\n    more\ntail\n\n[r][]\n')).toBe(
      '<ul>\n  <li><p>a</p>\n    <p>more\ntail</p>\n  </li>\n</ul>\n<p><a href="/u">r</a></p>',
    )
  })

  /**
   * A DESCRIPTION MARKER OPENS A CONTENT COLUMN, which the definition prepass
   * could not see - so a definition written at one rendered nowhere and defined
   * nothing, the one outcome a definition may never have.
   */
  it('registers a definition at a description content column', () => {
    expect(html(':: t\n:  a\n   [r]: /u\ntail\n\n[r][]\n')).toBe(
      '<dl>\n  <dt>t</dt>\n  <dd>a</dd>\n</dl>\n<p>tail</p>\n<p><a href="/u">r</a></p>',
    )
  })

  /**
   * A COMMENT IS NOT RICHER CONTENT. A description holding one paragraph and one
   * comment is the single-paragraph shape with an invisible block beside it.
   */
  it('keeps a description tight when its extra child is a comment', () => {
    expect(html(':: t\n:  a\n   %% c\ntail\n')).toBe(
      '<dl>\n  <dt>t</dt>\n  <dd>a</dd>\n</dl>\n<p>tail</p>',
    )
  })

  it('still closes an all-comment description on its own line', () => {
    // The survivor for that filter: with nothing visible left, the block arm
    // still renders the empty description rather than an empty paragraph.
    expect(html(':: t\n:  %% c\n')).toBe('<dl>\n  <dt>t</dt>\n  <dd></dd>\n</dl>')
  })

  /**
   * THE DESCENT IS A LOOP. Asking a nested quote what it ends on is a walk down
   * the whole prefix, and a tracker that recursed once per level overflowed the
   * stack on a document the parser otherwise handles - a denial of service under
   * §25, introduced by the pass added to answer a question about depth.
   */
  it('walks twenty thousand nested quotes without overflowing', () => {
    expect(() => parse('> '.repeat(20_000) + 'x')).not.toThrow()
  })
})
