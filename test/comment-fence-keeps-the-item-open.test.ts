import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/**
 * A comment fence inside a list item is INVISIBLE, so it may not end the item -
 * and it may not decide which list a following sibling marker belongs to.
 *
 * Two bugs in `trackItemLazyState`, and only both together explain it:
 *
 *  1. The comment-OPENER test required a bare `%%%` run, so an opener carrying an
 *     info string (`%%% x`) was missed. The tracker then matched the CLOSER as an
 *     opener and was left permanently "inside a comment".
 *  2. Closing a comment CLEARED `lazyFoldable` instead of restoring it. Since a
 *     comment renders nothing, the item ends in whatever it ended in before.
 *
 * With the tracker stuck inside a comment, every later line read as unfoldable,
 * the item ended at the fence, and `- c` started a SECOND list with the folded
 * line hoisted to document level (carve-js#659).
 *
 * Fixing (2) alone repairs the BARE-opener form only. For an opener with an info
 * string it changes nothing, because (1) means the closer is never reached as a
 * closer - which is why patching (2) first looked inert on every shape written
 * with `%%% x`.
 *
 * A third change is needed for the UNCLOSED form: `inComment` now counts like
 * `inFence` in the fold condition, because §28 makes an unclosed fence open no
 * block. Fixing (1) without that traded the closed-fence bug for an
 * unclosed-fence one.
 *
 * The executable spec and carve-rs agree on every shape below.
 */

const squash = (html: string) => html.replace(/\s+/g, ' ').replace(/> </g, '><').trim()

describe('a closed comment fence in a list item', () => {
  it('keeps the item open for a plain lazy line, and keeps one list', () => {
    expect(squash(carveToHtml('- a\n  %%% x\n  y\n  %%%\n b\n\n- c\n'))).toBe(
      '<ul><li><p>a</p><p>b</p></li><li><p>c</p></li></ul>',
    )
  })

  it('does the same for a block-shaped follower below the content column', () => {
    // `# h` is below the content column, so §24 C3 keeps it as item text rather
    // than nesting a heading. The comment must not change that either.
    expect(squash(carveToHtml('- a\n  %%% x\n  y\n  %%%\n # h\n\n- b\n'))).toBe(
      '<ul><li><p>a</p><p># h</p></li><li><p>b</p></li></ul>',
    )
  })

  it('works with a BARE opener too, which was broken for a different reason', () => {
    // The bare opener DID match the old test, so it entered comment state
    // correctly and then broke purely on the cleared `lazyFoldable` - fix (2)
    // alone repairs this one. The info-string forms above need fix (1) as well.
    // Measured, not assumed: with only (2) applied, this passes and the two
    // above still fail.
    expect(squash(carveToHtml('- a\n  %%%\n  y\n  %%%\n b\n\n- c\n'))).toBe(
      '<ul><li><p>a</p><p>b</p></li><li><p>c</p></li></ul>',
    )
  })
})

describe('the neighbouring comment spellings are unchanged', () => {
  it('a %% line comment keeps the item open', () => {
    expect(squash(carveToHtml('- a\n  %% x\n b\n\n- c\n'))).toBe(
      '<ul><li><p>a</p><p>b</p></li><li><p>c</p></li></ul>',
    )
  })

  it('an UNCLOSED %%% opener keeps the item open', () => {
    // §28: it opens no block, and it was already handled correctly.
    expect(squash(carveToHtml('- a\n  %%% x\n b\n\n- c\n'))).toBe(
      '<ul><li><p>a</p><p>b</p></li><li><p>c</p></li></ul>',
    )
  })

  it('the comment body itself never renders', () => {
    const out = carveToHtml('- a\n  %%% x\n  secret\n  %%%\n b\n')
    expect(out).not.toContain('secret')
    expect(out).not.toContain('%%%')
  })
})

describe('a CODE fence still ends the fold', () => {
  it('leaves no open paragraph, so a dedented line ends the item', () => {
    // The boundary the fix must not move: a code fence is VISIBLE and really
    // does leave no open paragraph, so the restore-on-close behaviour must be
    // specific to comments.
    const out = squash(carveToHtml('- a\n  ```\n  code\n  ```\n b\n\n- c\n'))
    expect(out).toContain('<code>')
    expect(out).not.toBe('<ul><li><p>a</p><p>b</p></li><li><p>c</p></li></ul>')
  })
})

/**
 * WHAT THE COMMENT MACHINE IS ACTUALLY FOR, and what every assertion above
 * failed to reach (markup-carve/carve-js#831).
 *
 * Both branches of the comment handling in `trackItemLazyState` could be
 * switched off outright - `if (commentRun !== undefined && false)` for the
 * opener, the same for the closer - and all 1373 corpus documents rendered
 * byte-identically and the whole 7309-test suite passed, this file included.
 * Its seven assertions all begin with `- a`, an ordinary paragraph, so the
 * item is FOLDABLE going into the comment. With the machine off the fence lines
 * fall through to the default branch and read as paragraph text, which leaves
 * the item foldable as well. Two different routes to the same answer, and the
 * shapes above cannot tell them apart.
 *
 * The machine earns its place where the state before the comment is NOT the
 * default: a construct that leaves NO OPEN PARAGRAPH. The comment renders
 * nothing, so it must not change the item's fold state - it saves that state
 * and restores it. Without the machine the fence lines re-open the fold, and a
 * dedented line that should have ended the item is swallowed into it.
 *
 * This file already carried the second half of each of these - "a CODE fence
 * still ends the fold" - without a comment after it. The pairing is the test.
 */
describe('a comment does not change a fold state that was already closed', () => {
  const CLOSED_BY: Array<[string, string]> = [
    ['a table', '  | x |\n'],
    ['a thematic break', '  ---\n'],
    ['a code fence', '  ```\n  z\n  ```\n'],
  ]

  for (const [what, block] of CLOSED_BY) {
    it(`keeps the item closed after ${what}, with a comment in between`, () => {
      // Without the comment machine this renders `lazy` INSIDE the item.
      const out = squash(carveToHtml(`- a\n${block}  %%% c\n  %%%\nlazy\n`))

      expect(out).toContain('<p>lazy</p>')
      expect(out).not.toContain('lazy </li>')
      // The CONTROL: the same document without the comment gives the same
      // answer, which is the whole claim - a comment is invisible.
      expect(out).toBe(squash(carveToHtml(`- a\n${block}lazy\n`)))
    })

    it(`ends the fold on the comment even where a PARAGRAPH re-opened it after ${what}`, () => {
      // SUPERSEDED READING, changed deliberately. This used to assert that a
      // paragraph after the block re-opens the fold and the comment does not
      // prevent it, on the premise that an invisible construct never changes
      // the item's state. `markup-carve/carve#1364` rules the other way: at a
      // container's content column a line is read as a BLOCK, a block ends the
      // paragraph it sits under, and WHAT IT RENDERS IS NOT A PARAMETER - so
      // the comment fence ends `para` and `lazy` at column 0 reaches no
      // container. carve-php `925f7dc` renders all three shapes this way.
      //
      // The invisibility claim survives one column in: the same comment written
      // BELOW the content column adds no block, and the fold holds. That is the
      // control, and it is what the pair below pins.
      const out = squash(carveToHtml(`- a\n${block}  para\n  %%% c\n  %%%\nlazy\n`))

      expect(out).toContain('<p>lazy</p>')
    })

    it(`still folds after ${what} when the comment sits BELOW the content column`, () => {
      // The other side of the control, so this is not just asserting that
      // everything ends the item: a paragraph after the block does re-open the
      // fold, and a comment that is not at the column does not close it again.
      const out = squash(carveToHtml(`- a\n${block}  para\n %%% c\n %%%\nlazy\n`))

      expect(out).not.toContain('<p>lazy</p>')
    })
  }
})
