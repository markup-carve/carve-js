import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * A comment fence is spelled once, and the lazy-state trackers read it.
 *
 * PART 9 §28 is NORMATIVE: a `%%%` line is DELIMITER PLUS INSIGNIFICANT TAIL -
 * the leading run of 3+ `%` is the delimiter, ANY remaining text is IGNORED, and
 * "the CLOSER matches on EXACT delimiter length (§2), so a longer opener nests
 * shorter fences and a too-short line is content, not a closer". `grammar.ebnf`
 * spells both delimiters `[whitespace], ("%%%", {'%'}), {character - newline}`,
 * so both may also be INDENTED.
 *
 * `parseCommentBlock` reads exactly that. The two lazy-state trackers did not:
 * they spelled the same line `^(%{3,})\s*$` - a BARE run at column 0 - and
 * compared the closer with `>=`, which is the CODE fence's rule. Three
 * divergences from one production, in the direction OPPOSITE to the legacy-`\s`
 * family swept in markup-carve/carve-js#815: there `\s` admitted too much, here
 * `\s*$` admitted less than the path beside it (markup-carve/carve-js#816).
 *
 * The observable consequence is the lazy-continuation decision. Where the
 * tracker cannot see a fence the parser consumes, the two disagree about whether
 * a comment is still open, and a following flush-left line is swallowed into the
 * quote instead of ending it.
 */

const html = (source: string) => carveToHtml(source).replace(/\s+/g, ' ').trim()

/*
 * Every row below is the SAME document with the fence written a different legal
 * way, so the reference answer is the bare spelling's - which was already right.
 */
const BARE = '> %%%\n> secret\n> %%%\nlazy\n'

describe('every legal spelling of a fence answers as the bare one does', () => {
  const spellings: Array<[string, string]> = [
    ['a tail on the opener', '> %%% TODO\n> secret\n> %%%\nlazy\n'],
    ['a tail on the closer', '> %%%\n> secret\n> %%% end\nlazy\n'],
    ['a tail on both', '> %%% TODO\n> secret\n> %%% end\nlazy\n'],
    ['an indented opener', '>  %%%\n> secret\n> %%%\nlazy\n'],
    ['an indented closer', '> %%%\n> secret\n>  %%%\nlazy\n'],
    ['a tab-indented opener', '> \t%%%\n> secret\n> %%%\nlazy\n'],
  ]

  for (const [label, source] of spellings) {
    it(`closes the comment and ends the quote: ${label}`, () => {
      // Asserted against the bare spelling rather than against a literal, so the
      // claim is AGREEMENT. A change that broke all of them together would still
      // have to break the reference row to pass unnoticed, and that row is
      // pinned literally below.
      expect(html(source)).toBe(html(BARE))
      expect(html(source)).not.toContain('secret')
    })
  }

  it('the reference row itself, pinned literally', () => {
    expect(html(BARE)).toBe('<blockquote> </blockquote> <p>lazy</p>')
  })
})

describe('content after the closer re-opens a paragraph the lazy line folds into', () => {
  /*
   * The shapes above cannot tell a recognized CLOSER from an unrecognized one:
   * "still inside a comment" and "closed, with nothing after it" both leave no
   * open paragraph, so the lazy line ends the quote either way. Reverting only
   * the closer passed every one of them.
   *
   * Putting quoted CONTENT between the closer and the lazy line is what
   * separates the two: when the closer is seen, `after` is an open paragraph and
   * `lazy` folds into it; when it is not, the tracker is still in a comment and
   * the quote ends instead.
   */
  const AFTER_BARE = '> %%%\n> secret\n> %%%\n> after\nlazy\n'

  it('the reference row, pinned literally', () => {
    expect(html(AFTER_BARE)).toBe('<blockquote> <p>after lazy</p> </blockquote>')
  })

  for (const [label, source] of [
    ['a tail on the closer', '> %%%\n> secret\n> %%% end\n> after\nlazy\n'],
    ['an indented closer', '> %%%\n> secret\n>  %%%\n> after\nlazy\n'],
    ['a tab-indented closer', '> %%%\n> secret\n> \t%%%\n> after\nlazy\n'],
    ['a longer run inside, then the real closer', '> %%%\n> a\n> %%%%\n> b\n> %%%\n> after\nlazy\n'],
  ] as const) {
    it(`answers as the bare closer does: ${label}`, () => {
      expect(html(source)).toBe(html(AFTER_BARE))
    })
  }
})

describe('the closer matches on exact length, not on at-least', () => {
  it('a longer run inside a comment is body, not a closer', () => {
    // §28: a longer opener nests shorter fences, so a LONGER line inside a
    // shorter fence is ordinary body text. Read as `>=`, the tracker closed the
    // comment at `%%%%` and then re-opened it at the real closer, leaving it
    // open forever.
    const source = '> %%%\n> a\n> %%%%\n> b\n> %%%\nlazy\n'

    expect(html(source)).toBe(html(BARE))
  })

  it('CONTROL: a shorter run inside a longer fence is body too', () => {
    // The other half of the same clause, and the half `>=` already answered
    // correctly - so no mutation of the comparison can move this row on its own.
    const source = '> %%%%\n> a\n> %%%\n> b\n> %%%%\nlazy\n'

    expect(html(source)).toBe(html(BARE))
  })
})

describe('the list-item tracker reads the same production', () => {
  // The third site. Its OPENER already allowed a tail - fixed by
  // markup-carve/carve-js#659 - while its CLOSER carried a comment saying "a
  // CLOSER is a bare run, so this test stays anchored". §28 gives the closer the
  // same insignificant tail as the opener, so that comment was the defect
  // written down.
  const ITEM_BARE = '- %%%\n  secret\n  %%%\nlazy\n'

  const spellings: Array<[string, string]> = [
    ['a tail on the closer', '- %%%\n  secret\n  %%% end\nlazy\n'],
    ['a tail on the opener', '- %%% TODO\n  secret\n  %%%\nlazy\n'],
    ['an indented closer', '- %%%\n  secret\n   %%%\nlazy\n'],
    ['a longer run inside', '- %%%\n  a\n  %%%%\n  b\n  %%%\nlazy\n'],
  ]

  for (const [label, source] of spellings) {
    it(`answers as the bare spelling does: ${label}`, () => {
      expect(html(source)).toBe(html(ITEM_BARE))
      expect(html(source)).not.toContain('secret')
    })
  }
})

describe('shapes the spellings cannot disagree about', () => {
  it('CONTROL: a quote with no comment at all', () => {
    expect(html('> a\nlazy\n')).toBe('<blockquote><p>a lazy</p></blockquote>')
  })

  it('CONTROL: an item with no comment at all', () => {
    expect(html('- a\nlazy\n')).toBe('<ul> <li>a lazy</li> </ul>')
  })

  it('CONTROL: a two-percent line comment is not a fence', () => {
    // `%%` is `inline_comment`, a different production, and narrowing the fence
    // predicate must not start claiming it.
    expect(html('> %% note\n> a\nlazy\n')).toBe('<blockquote> <p>a lazy</p> </blockquote>')
  })
})

describe('an UNTERMINATED fence does not open a block, in a quote either', () => {
  it('all three spellings agree, and all three are right now', () => {
    // §28: "A `%%%` opener with NO MATCHING CLOSER AHEAD does NOT open a block.
    // The line degrades to a `comment_line`". So `secret` is an open paragraph
    // in the quote and `lazy` folds into it.
    //
    // This assertion was pinned as WRONG when #816 made the three spellings
    // agree: the tracker runs while the quote's lines are being COLLECTED and
    // had nothing to scan, so it treated every opener as opening. It has the
    // same lookahead the block parser has always had now (carve-js#832).
    const bare = html('> %%%\n> secret\nlazy\n')

    expect(html('> %%% TODO\n> secret\nlazy\n')).toBe(bare)
    expect(html('>  %%%\n> secret\nlazy\n')).toBe(bare)
    expect(bare).toBe('<blockquote> <p>secret lazy</p> </blockquote>')
  })

  it('CONTROL: a TERMINATED fence still opens one', () => {
    // The boundary the lookahead must not move. With a closer ahead the fence
    // really does open a block, the comment renders nothing, and the quote is
    // left holding no open paragraph - so the lazy line ends it.
    expect(html('> %%%\n> secret\n> %%%\nlazy\n')).toBe(
      '<blockquote> </blockquote> <p>lazy</p>',
    )
  })

  it('CONTROL: the closer must match the width exactly', () => {
    // A `%%%%` line does not close a `%%%` opener (§28 matches on EXACT
    // length), so this document has no closer for either width and both
    // degrade - which is the un-opened answer, not the opened one.
    expect(html('> %%%\n> secret\n> %%%%\nlazy\n')).not.toBe(
      html('> %%%\n> secret\n> %%%\nlazy\n'),
    )
    expect(html('> %%%\n> secret\n> %%%%\nlazy\n')).toContain('secret')
  })

  it('does not take a fence one level DEEPER as its closer', () => {
    // The lookahead strips ONE quote marker, not the whole run. Stripping all of
    // them made `> > %%%` close a fence opened at one `>`, where the sub-lexer
    // reads that line as a nested block quote - so the tracker and the parse of
    // the collected body disagreed. Raised by codex review.
    expect(html('> %%%\n> secret\n> > %%%\nlazy\n')).toBe(
      '<blockquote> <p>secret</p> <blockquote> <p>lazy</p> </blockquote> </blockquote>',
    )
  })

  it('does not take a fence OUTSIDE the quote as its closer', () => {
    // The other bound, found by widening the probe past the shape the review
    // named: the scan stops at the first unquoted line instead of running to the
    // end of the document, so a `%%%` after the quote is not its closer. A
    // non-quoted line cannot belong to the quote here anyway - a lazy
    // continuation is collected only while a paragraph is open, and inside a
    // comment none is.
    expect(html('> %%%\n> secret\nlazy\n\n%%%\n')).toContain('<p>secret lazy</p>')
  })

  it('CONTROL: a nested wider fence still closes its own opener', () => {
    // The other direction, so the width test is not just rejecting everything:
    // `%%%%` opens and `%%%%` closes, with a `%%%` inside it nested and hidden.
    expect(html('> %%%%\n> %%%\n> secret\n> %%%%\nlazy\n')).not.toContain('secret')
  })

  it('CONTROL: at top level the degradation is correct', () => {
    // The block parser DOES look ahead, so the same fence degrades properly
    // outside a container. This is the row that shows the gap is the tracker's
    // and not the rule's.
    expect(html('%%% TODO\nsecret\n\nafter\n')).toBe('<p>secret</p> <p>after</p>')
  })
})
