import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// ---------------------------------------------------------------------------
// AN UNTERMINATED `%%%` IS A `%%` LINE COMMENT (markup-carve/carve-js#1600).
//
// PART 9 §28: "A `%%%` opener with NO MATCHING CLOSER AHEAD does NOT open a
// block. The line degrades to a `comment_line`". PART 0 says the same from the
// layout side, under COMMENTS ARE CLASSIFIED BEFORE BLOCK OWNERSHIP: "An opener
// without an exact-width closer is one `%%` line comment; later lines are
// classified normally." So at one column the two spellings cannot answer
// differently, and the item's tracker used to open on every fence.
//
// BELOW THE CONTENT COLUMN IS A DIFFERENT QUESTION and is deliberately left
// where it stands: no reader applies the substitution there, and the reading is
// open at markup-carve/carve#1903. Every row below is measured against the
// executable spec (scripts/spec/layout.mjs into scripts/spec/html.mjs) and
// against carve-rs.
// ---------------------------------------------------------------------------

const item = (payload: string, col: number, ...tail: string[]): string =>
  ['- x', ' '.repeat(col) + payload, ...tail].join('\n') + '\n'

const ITEM_ONLY = '<ul>\n  <li>x</li>\n</ul>'
const FOLDED = '<ul>\n  <li>x\n    y\n  </li>\n</ul>'

describe('an unterminated comment fence inside a list item', () => {
  it('ends the item on the reported document', () => {
    expect(carveToHtml(item('%%%', 2, 'y'))).toBe(`${ITEM_ONLY}\n<p>y</p>`)
  })

  // THE TWO NEIGHBOURS ARE THE CONTROL. Same host, same column, follower flush
  // left: only the middle spelling used to move.
  it.each([
    ['the line form', item('%% z', 2, 'y')],
    ['a terminated fence', item('%%%', 2, '  %%%', 'y')],
    ['an unterminated fence', item('%%%', 2, 'y')],
  ])('reads %s at the content column the same way', (_name, source) => {
    expect(carveToHtml(source)).toBe(`${ITEM_ONLY}\n<p>y</p>`)
  })

  // THE DELIMITER RUN IS NOT THE QUESTION, AND NEITHER IS THE TAIL. §28 makes
  // the leading run the delimiter and everything after it insignificant.
  it.each(['%%%', '%%% ', '%%% t', '%%%%', '%%%%%', '%%%x'])(
    'degrades %s identically',
    (fence) => {
      expect(carveToHtml(item(fence, 2, 'y'))).toBe(`${ITEM_ONLY}\n<p>y</p>`)
    },
  )

  // THE BAND. `- x` hands its body out at column 2. Columns 0 and 1 are
  // carve#1903's open question and answer as they always have; from the content
  // column up the fence answers as the line form does.
  it.each([
    [0, ITEM_ONLY + '\n<p>y</p>'],
    [1, FOLDED],
    [2, ITEM_ONLY + '\n<p>y</p>'],
    [3, ITEM_ONLY + '\n<p>y</p>'],
    [4, ITEM_ONLY + '\n<p>y</p>'],
    [5, ITEM_ONLY + '\n<p>y</p>'],
  ])('answers column %i', (col, expected) => {
    expect(carveToHtml(item('%%%', col, 'y'))).toBe(expected)
  })

  // THE BAND MOVES WITH THE CONTENT COLUMN, which is what makes it a column
  // rule rather than the constant 2.
  it.each([
    ['1. x', 2, '<ol>\n  <li>x\n    y\n  </li>\n</ol>'],
    ['1. x', 3, '<ol>\n  <li>x</li>\n</ol>\n<p>y</p>'],
    ['-   x', 3, '<ul>\n  <li>x\n    y\n  </li>\n</ul>'],
    ['-   x', 4, '<ul>\n  <li>x</li>\n</ul>\n<p>y</p>'],
  ])('answers %s at column %i', (lead, col, expected) => {
    expect(carveToHtml([lead, ' '.repeat(col) + '%%%', 'y'].join('\n') + '\n')).toBe(expected)
  })

  it('applies the rule at a nested item\'s own content column', () => {
    expect(carveToHtml('- - x\n    %%%\ny\n')).toBe(
      '<ul>\n  <li>\n    <ul>\n      <li>x</li>\n    </ul>\n  </li>\n</ul>\n<p>y</p>',
    )
  })
})

describe('the closer that decides whether the fence opens', () => {
  // A run written below the item's content column is not inside the fence's
  // container, so it closes nothing and the opener still degrades. The
  // difference is visible: `y` is PUBLISHED at document level rather than
  // hidden as comment body.
  it('is not a run below the content column', () => {
    expect(carveToHtml(item('%%%', 2, 'y', '  %%%', 'z'))).toBe(
      `${ITEM_ONLY}\n<p>y</p>\n<p>z</p>`,
    )
  })

  // §28 matches the closer on EXACT delimiter length, so a longer run nests
  // rather than closing, and the opener is still unterminated.
  it('is not a run of a different width', () => {
    expect(carveToHtml(item('%%%', 2, '  %%%%', 'z'))).toBe(`${ITEM_ONLY}\n<p>z</p>`)
    expect(carveToHtml(item('%%%%', 2, '  %%%', 'z'))).toBe(`${ITEM_ONLY}\n<p>z</p>`)
  })

  // A blank inside a comment body is body, and a blank followed by an indented
  // line has not left the item, so the search does not stop there.
  it('is still reachable across a blank line', () => {
    expect(carveToHtml('- x\n  %%%\n\n  secret\n  %%%\n\n  y\n')).toBe(
      '<ul>\n  <li><p>x</p>\n    <p>y</p>\n  </li>\n</ul>',
    )
  })

  // The terminated fence is a real block, and a closed block at the content
  // column leaves no paragraph for a column-0 line to continue.
  it('opens a real block when it is present', () => {
    expect(carveToHtml('- x\n  %%%\n  secret\n  %%%\ny\n')).toBe(`${ITEM_ONLY}\n<p>y</p>`)
    expect(carveToHtml('- x\n  %%%\n  secret\n  %%%\n')).toBe(ITEM_ONLY)
  })

  it('hides the body of the block it opens, and only that', () => {
    const html = carveToHtml('- x\n  %%%\n  secret\n  %%%\n  after\n')

    expect(html).not.toContain('secret')
    expect(html).toContain('after')
  })

  // The degraded opener renders nothing either - it is still a comment, and
  // that is the whole reason §28 refuses to let it swallow the document.
  it('renders nothing when it degrades', () => {
    expect(carveToHtml(item('%%% secret', 2, 'y'))).not.toContain('secret')
  })
})
