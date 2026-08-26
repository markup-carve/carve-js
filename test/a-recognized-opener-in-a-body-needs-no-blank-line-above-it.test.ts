import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

/**
 * A RECOGNIZED OPENER IN A BODY NEEDS NO BLANK LINE ABOVE IT
 * (markup-carve/carve#1769, corpus categories 422 and 423;
 * markup-carve/carve-js#1518).
 *
 * The authored-base clause (PART 9 §17, PART 9 §24 C3, carve#1729) says where
 * an opener may sit, not what has to sit above it. Two things follow, and the
 * spec states them as two categories that only make sense read against each
 * other:
 *
 *  - 422: an opener at or past a body's minimum column belongs to that body
 *    whether or not a blank line precedes it, and a payload written DIRECTLY
 *    under a description line is the description's content at any indent above
 *    zero - below its own content column included, since nothing stands between
 *    the marker and the line for the separator's width to measure;
 *  - 423: a blank line inside a LIST ITEM clears the authored block base, where
 *    the same blank inside a definition body or a footnote body does not. §24
 *    C3 names a definition body's column 3 and a footnote body's column 2, and a
 *    list item is neither.
 *
 * BOTH BANDS ARE PINNED HERE, blank against no-blank, because the failure this
 * engine actually had was one-sided: it read the no-blank band as the BELOW
 * band (`below-the-body-s-column-the-body-ends.test.ts`) and got the blank band
 * right, so a fix aimed at either one alone drifts the other.
 *
 * The ten documents below are the corpus files verbatim. This engine's spec pin
 * predates them, so `corpus.test.ts` cannot run the category and its
 * `AHEAD_OF_PIN` map cannot name a slug the pinned corpus does not carry - the
 * same position carve-js#1528 was in for category 424. Delete this file's
 * `corpus documents` block when the pin moves past carve 7012107a and the
 * corpus runner picks the category up.
 */
describe('a recognized opener in a body needs no blank line above it', () => {
  describe('corpus documents', () => {
    it('422-a-recognized-opener-in-a-body-needs-no-blank-line-above-it - a footnote body takes a quote and a heading with no blank line above them', () => {
      expect(carveToHtml(`[^n]: intro
  > quote
  # heading

see[^n]
`).trim()).toBe(
        `<p>see<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>
<section role="doc-endnotes" aria-label="Footnotes">
  <hr>
  <ol>
    <li id="fn1">
      <p>intro</p>
      <blockquote><p>quote</p></blockquote>
      <h1 id="heading">heading</h1>
      <p><a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>
    </li>
  </ol>
</section>`,
      )
    })

    it('422-a-recognized-opener-in-a-body-needs-no-blank-line-above-it-2 - a definition body takes them the same way', () => {
      expect(carveToHtml(`:: term
:  intro
   > quote
   # heading
`).trim()).toBe(
        `<dl>
  <dt>term</dt>
  <dd>
    <p>intro</p>
    <blockquote><p>quote</p></blockquote>
    <h1 id="heading">heading</h1>
  </dd>
</dl>`,
      )
    })

    it('422-a-recognized-opener-in-a-body-needs-no-blank-line-above-it-3 - a list item takes them the same way', () => {
      expect(carveToHtml(`- intro
  > quote
  # heading
`).trim()).toBe(
        `<ul>
  <li>intro
    <blockquote><p>quote</p></blockquote>
    <h1 id="heading">heading</h1>
  </li>
</ul>`,
      )
    })

    it('422-a-recognized-opener-in-a-body-needs-no-blank-line-above-it-4 - a line that opens nothing is not rebased and ends nothing', () => {
      expect(carveToHtml(`[^n]: intro
  > quote
    ordinary line

see[^n]
`).trim()).toBe(
        `<p>see<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>
<section role="doc-endnotes" aria-label="Footnotes">
  <hr>
  <ol>
    <li id="fn1">
      <p>intro</p>
      <blockquote><p>quote
ordinary line</p></blockquote>
      <p><a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>
    </li>
  </ol>
</section>`,
      )
    })

    it('422-a-recognized-opener-in-a-body-needs-no-blank-line-above-it-5 - the rule reaches every member of a run, not only the first', () => {
      expect(carveToHtml(`[^n]: intro
  > quote
  # heading
  - item

see[^n]
`).trim()).toBe(
        `<p>see<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>
<section role="doc-endnotes" aria-label="Footnotes">
  <hr>
  <ol>
    <li id="fn1">
      <p>intro</p>
      <blockquote><p>quote</p></blockquote>
      <h1 id="heading">heading</h1>
      <ul>
        <li>item</li>
      </ul>
      <p><a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>
    </li>
  </ol>
</section>`,
      )
    })

    it('422-a-recognized-opener-in-a-body-needs-no-blank-line-above-it-6 - the top level is not a body, so an indented opener folds into the paragraph', () => {
      expect(carveToHtml(`intro
   # heading
`).trim()).toBe(
        `<p>intro
# heading</p>`,
      )
    })

    it("422-a-recognized-opener-in-a-body-needs-no-blank-line-above-it-7 - a payload directly under a description line is the description's content", () => {
      expect(carveToHtml(`:: term
:  definition
 > quote
`).trim()).toBe(
        `<dl>
  <dt>term</dt>
  <dd>
    <p>definition</p>
    <blockquote><p>quote</p></blockquote>
  </dd>
</dl>`,
      )
    })

    it('422-a-recognized-opener-in-a-body-needs-no-blank-line-above-it-8 - the same band inside a list item', () => {
      expect(carveToHtml(`- intro

  :: term
  :  definition
   > quote
`).trim()).toBe(
        `<ul>
  <li>intro
    <dl>
      <dt>term</dt>
      <dd>
        <p>definition</p>
        <blockquote><p>quote</p></blockquote>
      </dd>
    </dl>
  </li>
</ul>`,
      )
    })

    it('422-a-recognized-opener-in-a-body-needs-no-blank-line-above-it-9 - the same band inside a footnote body', () => {
      expect(carveToHtml(`[^n]: intro

   :: term
   :  definition
    > quote

see[^n]
`).trim()).toBe(
        `<p>see<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>
<section role="doc-endnotes" aria-label="Footnotes">
  <hr>
  <ol>
    <li id="fn1">
      <p>intro</p>
      <dl>
        <dt>term</dt>
        <dd>
          <p>definition</p>
          <blockquote><p>quote</p></blockquote>
        </dd>
      </dl>
      <p><a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>
    </li>
  </ol>
</section>`,
      )
    })

    it('423-the-definition-and-footnote-base-rule-does-not-reach-a-list-item - a blank line inside a list item clears the authored base', () => {
      expect(carveToHtml(`- intro

   :: term
   :  definition

      > quote
`).trim()).toBe(
        `<ul>
  <li>intro
    <dl>
      <dt>term</dt>
      <dd>definition</dd>
    </dl>
    <blockquote><p>quote</p></blockquote>
  </li>
</ul>`,
      )
    })

  })

  describe('the seam between the two bands', () => {
    // The ONE-CHARACTER difference between the two corpus documents is the
    // blank line, and it is what decides which container holds the quote. Read
    // as a pair they cannot both be satisfied by a rule that ignores it, which
    // is the property the fix had to have.
    it('a blank line is the whole of the difference in a list item', () => {
      const stays = carveToHtml('- intro\n\n  :: term\n  :  definition\n   > quote\n')
      const leaves = carveToHtml('- intro\n\n   :: term\n   :  definition\n\n      > quote\n')

      expect(stays).toContain('<dd>\n        <p>definition</p>\n        <blockquote>')
      expect(leaves).toContain('<dd>definition</dd>')
      expect(leaves).toContain('</dl>\n    <blockquote>')
      expect(stays).not.toBe(leaves)
    })
  })

  describe('the sub-column band under a description line', () => {
    // The rule stated as an INVARIANT rather than one row per opener: directly
    // under the description line, every indent above zero answers exactly as
    // the body's own content column does. That is what "the separator's width
    // does not decide" means, and it is stated over the whole opener family the
    // rebase pass recognizes - a rule wired to the blockquote pattern alone
    // passes the corpus documents above and fails here.
    const at = (n: number, opener: string) =>
      carveToHtml(':: t\n:  body\n' + ' '.repeat(n) + opener + '\n')
    const openers = [
      '> q',
      '# h',
      '| a |',
      '---',
      '::: note',
      '{.x}',
      '[a]: /u',
      '%% c',
      '- i',
      '1. i',
      '![i](/u)',
    ]

    it.each(openers)('%s answers at 1, 2, 4 and 5 as it answers at 3', (opener) => {
      const column = at(3, opener)
      for (const n of [1, 2, 4, 5]) expect(at(n, opener)).toBe(column)
    })

    it('COLUMN 0 is the one that ends the body', () => {
      // The floor, and the half that keeps carve#932's clause alive: the rule
      // is "above zero", so column 0 has to still leave the description. Every
      // opener that really opens at the top level shows it; the three that open
      // nothing there are recorded as the controls they are.
      for (const opener of ['> q', '# h', '| a |', '---', '::: note']) {
        expect(at(0, opener)).not.toBe(at(1, opener))
        expect(at(0, opener).startsWith('<dl>\n  <dt>t</dt>\n  <dd>body</dd>\n</dl>\n')).toBe(true)
      }
      // CONTROL: not evidence. These three open nothing at column 0 either, so
      // they agree across the floor for a reason that has nothing to do with
      // this band.
      for (const opener of ['{.x}', '[a]: /u', '%% c']) {
        expect(at(0, opener)).toBe(at(1, opener))
      }
    })

    it('the payload keeps the run it owns, not only its opening line', () => {
      // The reach is the BODY'S COLUMN, lowered to where the author put the
      // payload - so a quote's second line and a fence's body and closer reach
      // it for the same reason the opener did. A fix that admitted the opener
      // alone passes every corpus document above and drops these tails: the
      // quote's `r` lands outside the `dd`, in the list item in the second row.
      expect(carveToHtml(':: t\n:  body\n > q\n > r\n')).toBe(
        '<dl>\n  <dt>t</dt>\n  <dd>\n    <p>body</p>\n    <blockquote><p>q\nr</p></blockquote>\n  </dd>\n</dl>',
      )
      expect(carveToHtml('- intro\n\n  :: term\n  :  definition\n   > q\n   > r\n')).toBe(
        '<ul>\n  <li>intro\n    <dl>\n      <dt>term</dt>\n      <dd>\n        <p>definition</p>\n        <blockquote><p>q\nr</p></blockquote>\n      </dd>\n    </dl>\n  </li>\n</ul>',
      )
    })

    it('CONTROL a code fence directly under a description line was already inside', () => {
      // NOT EVIDENCE, and recorded so it is not mistaken for it. A fence takes
      // this path through the lazy tracker rather than through the opener
      // classification, so it sat in the `dd` at a sub-column before this rule
      // existed while a quote one column away did not. The row is here because
      // that inconsistency is what the rule removes, and because it fails if
      // the run behind the fence ever stops coming with it.
      expect(carveToHtml(':: t\n:  body\n ```\n c\n ```\n')).toBe(
        '<dl>\n  <dt>t</dt>\n  <dd>\n    <p>body</p>\n    <pre><code>c\n</code></pre>\n  </dd>\n</dl>',
      )
    })

    it('only the line DIRECTLY under the marker is in the band', () => {
      // The reach is one line, not "any line below the column". With a
      // continuation of the body standing between, the BELOW band governs again
      // and the quote leaves the description - which is the row
      // `below-the-body-s-column-the-body-ends.test.ts` is built on.
      expect(carveToHtml(':: t\n:  body\n   more\n > q\n')).toBe(
        '<dl>\n  <dt>t</dt>\n  <dd>body\nmore</dd>\n</dl>\n<p>&gt; q</p>',
      )
    })
  })
})
