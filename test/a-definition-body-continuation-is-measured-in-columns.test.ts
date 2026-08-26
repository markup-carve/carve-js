import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

/**
 * A definition body's continuation is a COLUMN claim (markup-carve/carve-js#812).
 *
 * `definition_continuation` is a leading indentation run, so a tab is syntax
 * there and advances to the next multiple of 4 - markup-carve/carve#888's
 * signoff, reaffirmed by markup-carve/carve#901, and the same family as
 * markup-carve/carve#692, #796 and #905. This engine counted CHARACTERS, so
 * whether the body continued depended on how the author spelled a run rather
 * than where it landed: a lone tab reaches column 4 and ended the body, while
 * three spaces reach column 3 and continued it.
 *
 * The rule is spelled twice in `parseDefinitionList`, with different jobs - a
 * blank-line lookahead deciding whether the body survives a blank, and the
 * Form A branch deciding whether a line folds - so the two are pinned
 * separately below. Neither shape catches a mutation of the other.
 */
describe("a definition body's continuation is measured in columns", () => {
  // Does the body continue PAST A BLANK LINE? This routes through the
  // blank-line lookahead, and the observable (a second paragraph inside the
  // `dd`, versus a `p` outside the `dl`) does not depend on how far the line
  // is dedented once it is in.
  const continuesPastABlank = (run: string): boolean =>
    /<dd>[\s\S]*<p>more<\/p>[\s\S]*<\/dd>/.test(carveToHtml(`:: t\n:  body\n\n${run}more\n`))

  describe('past a blank line', () => {
    it.each([
      { run: '   ', column: 3, name: 'three spaces' },
      { run: '\t', column: 4, name: 'a tab' },
      { run: ' \t', column: 4, name: 'a space then a tab' },
      { run: '  \t', column: 4, name: 'two spaces then a tab' },
      { run: '   \t', column: 4, name: 'three spaces then a tab' },
      { run: '\t ', column: 5, name: 'a tab then a space' },
      { run: '\t\t', column: 8, name: 'two tabs' },
    ])('continues on $name (column $column)', ({ run }) => {
      expect(continuesPastABlank(run)).toBe(true)
    })

    it.each([
      { run: '', column: 0, name: 'nothing' },
      { run: ' ', column: 1, name: 'one space' },
      { run: '  ', column: 2, name: 'two spaces' },
    ])('ends on $name (column $column)', ({ run }) => {
      // The threshold from BELOW. Without these, reading the run as "any
      // indentation at all" satisfies every row above.
      expect(continuesPastABlank(run)).toBe(false)
    })
  })

  describe('with no blank line (the Form A branch, in isolation)', () => {
    it('opens a block at the authored base a tab reaches', () => {
      const tabbed = carveToHtml(':: t\n:  body\n\t> q\n')

      expect(tabbed).toContain('<blockquote>')
      expect(tabbed).toBe(carveToHtml(':: t\n:  body\n    > q\n'))
    })

    it('still folds one at three spaces STRUCTURALLY, which is the body column', () => {
      // The column the body establishes, where a nested block really does open.
      // Losing this would make the rule "an indented opener is never a block",
      // which is a different rule and the wrong one.
      expect(carveToHtml(':: t\n:  body\n   > q\n')).toContain('<blockquote>')
    })

    it('leaves one two columns in as lazy text', () => {
      // The boundary. Folding every indented opener would satisfy both
      // assertions above.
      //
      // Measured one line further down, because the line DIRECTLY under the
      // description is the description's own payload at any indent above zero
      // (markup-carve/carve#1769, markup-carve/carve-js#1518) - so the boundary
      // is only visible once something stands between the marker and the
      // opener. A continuation at the body's own column is that something, and
      // it leaves the columns being measured untouched.
      expect(carveToHtml(':: t\n:  body\n   more\n  > q\n')).not.toContain('<blockquote>')
    })
  })

  it('CONTROL: a plain line with no blank before it folds either way', () => {
    // Not evidence. A plain line that fails the indent test folds through LAZY
    // continuation, which never inspects indentation - so this shape reads the
    // same before and after the fix, and under every mutation of either slot.
    // It is recorded so it is not mistaken for a pin: an earlier probe reported
    // cross-engine agreement that was not there, for exactly this reason.
    expect(carveToHtml(':: t\n:  body\n\tmore\n')).toBe(carveToHtml(':: t\n:  body\n   more\n'))
  })
})
