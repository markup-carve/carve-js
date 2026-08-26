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
 *    whether or not a blank line precedes it; below a nested definition's own
 *    content column that definition ends and the surviving owner classifies it;
 *  - 423: a blank line ends a paragraph but not the complete block whose local
 *    base owns it. List, definition and footnote bodies share that rule.
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
 * `corpus documents` block when the pin moves past carve 6dac47e2 and the
 * corpus runner picks the categories up.
 *
 * RE-CUT BY carve#1781 AND EXTENDED BY carve#1791 (carve-js#1535). The
 * unification made the base ONE rule for every container, which moved four of
 * the documents below, and #1791 then named a LIST ITEM as a container the rule
 * reaches too. The `.crv` inputs never changed - only the goldens - so a stale
 * expectation here would read as a passing test of the PREVIOUS ruling.
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

    it('422-a-recognized-opener-in-a-body-needs-no-blank-line-above-it-7 - below the description column the body ends', () => {
      expect(carveToHtml(`:: term
:  definition
 > quote
`).trim()).toBe(
        `<dl>
  <dt>term</dt>
  <dd>definition</dd>
</dl>
<p>&gt; quote</p>`,
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
      <dd>definition</dd>
    </dl>
    <blockquote><p>quote</p></blockquote>
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
        <dd>definition</dd>
      </dl>
      <blockquote><p>quote</p></blockquote>
      <p><a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>
    </li>
  </ol>
</section>`,
      )
    })

    it('423-one-authored-base-rule-reaches-a-definition-nested-in-a-list-item', () => {
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

    it('423-one-authored-base-rule-reaches-a-definition-nested-in-a-list-item-2 - a list item is a container the rule reaches too', () => {
      // carve#1791. `opensSubBlock` answers a DIFFERENT question - whether a
      // blank-separated sub-block leaves a list TIGHT - and a list marker is
      // deliberately absent from it there, because a marker at a body's own
      // column opens a SUBLIST rather than a sub-block. Ownership has the other
      // answer: a marker's content belongs to the item it opens, so a quote
      // written at the item's content column stays IN the item instead of being
      // rebased to the footnote body's column and lifted out of it.
      expect(carveToHtml(`[^n]: intro

  - item

    > quote

see[^n]
`).trim()).toBe(
        `<p>see<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>
<section role="doc-endnotes" aria-label="Footnotes">
  <hr>
  <ol>
    <li id="fn1">
      <p>intro</p>
      <ul>
        <li>item
          <blockquote><p>quote</p></blockquote>
        </li>
      </ul>
      <p><a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a></p>
    </li>
  </ol>
</section>`,
      )
    })

  })

  /*
   * THE POINT OF THE RULE, STATED AS AN EQUALITY.
   *
   * "The base belongs to the innermost open container" means a body answers a
   * given authored column exactly as the top level answers it - the container
   * it is written in does not get a say. Pinned as an INVARIANT over the column
   * band rather than as a golden, because the failure it catches is one-sided
   * and a golden fixes only the column it names.
   *
   * Before carve#1781 this engine gave the SAME answer at every column inside a
   * footnote body - two sibling quotes at 0, 1, 2, 3, 4 and 5 alike - which is
   * the body ignoring the author's indentation outright. It agreed with the top
   * level at column 0 by coincidence and nowhere else.
   */
  describe('a body answers an authored column as the top level does', () => {
    const norm = (html: string) => html.replace(/\s+/g, ' ').trim()
    const inNote = (html: string) =>
      norm(html.split('<li id="fn1">')[1]?.split('<p><a href="#fnref1"')[0] ?? '')

    // A footnote body strips a two-column margin, so an authored column of `n`
    // inside it is spelled at `2 + n`.
    it.each([0, 1, 2, 3, 4, 5])('a quote fence at column %i', (n) => {
      const pad = ' '.repeat(n)
      const top = `> q\n${pad}::: >\n${pad}b\n${pad}:::\n`
      const note =
        '[^a]: > q\n' +
        ['::: >', 'b', ':::'].map((line) => ' '.repeat(2 + n) + line).join('\n') +
        '\n\nsee[^a]\n'
      expect(inNote(carveToHtml(note))).toBe(norm(carveToHtml(top)))
    })

    // The band is not constant, so the equality above is not vacuous: at column
    // 0 the fence ENDS the quote and opens a sibling, and above it the fence is
    // a lazy continuation of the quoted paragraph.
    it('the two ends of the band say different things', () => {
      expect(norm(carveToHtml('> q\n::: >\nb\n:::\n'))).toBe(
        '<blockquote><p>q</p></blockquote> <blockquote><p>b</p></blockquote>',
      )
      expect(norm(carveToHtml('> q\n ::: >\n b\n :::\n'))).toBe(
        '<blockquote><p>q ::: &gt; b :::</p></blockquote>',
      )
    })
  })

  describe('the seam between the two bands', () => {
    it('a blank line does not discard the definition list block base', () => {
      const stays = carveToHtml('- intro\n\n  :: term\n  :  definition\n   > quote\n')
      const leaves = carveToHtml('- intro\n\n   :: term\n   :  definition\n\n      > quote\n')

      expect(stays).toContain('<dd>definition</dd>')
      expect(stays).toContain('</dl>\n    <blockquote>')
      expect(leaves).toContain('<dd>\n        <p>definition</p>\n        <blockquote>')
      expect(leaves).not.toContain('</dl>\n    <blockquote>')
    })
  })

  describe('the description content-column band', () => {
    const at = (n: number, opener: string) =>
      carveToHtml(':: t\n:  body\n' + ' '.repeat(n) + opener + '\n')

    // THE WHOLE OPENER FAMILY, NOT ONE SHAPE. The rule is about a COLUMN, so
    // it has to answer the same way for every kind the rebase pass recognizes.
    // A rule keyed on the blockquote pattern alone satisfies every corpus
    // document in this file and still fails here, which is the reason this is
    // stated as a sweep rather than as one more row.
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

    // The separator `:  ` is three columns wide, so the description's content
    // column is 3.
    it.each(openers)('%s answers at 4 and 5 exactly as it answers at 3', (opener) => {
      const column = at(3, opener)
      for (const n of [4, 5]) expect(at(n, opener)).toBe(column)
    })

    // The other edge, and the one that keeps the sweep above from being
    // vacuous: for every opener that really opens a block, the two sides of the
    // content column say DIFFERENT things. Without this a rule that answered
    // "inside the description" at every indent would pass the sweep.
    it.each(['> q', '# h', '| a |', '---', '::: note'])(
      '%s below the content column is not what it is at it',
      (opener) => {
        expect(at(2, opener)).not.toBe(at(3, opener))
        expect(at(3, opener)).toContain('<dd>\n    <p>body</p>')
      },
    )

    // CONTROL, not evidence. These six open nothing that can loosen the body,
    // so they agree ACROSS the seam for a reason that has nothing to do with
    // this rule. Recorded so a later reader does not count them as coverage.
    it.each(['{.x}', '[a]: /u', '%% c', '- i', '1. i', '![i](/u)'])(
      'CONTROL %s opens nothing the description can hold',
      (opener) => {
        expect(at(3, opener)).toBe(at(5, opener))
      },
    )

    it('the payload keeps the run it owns, not only its opening line', () => {
      // The reach is the BODY'S COLUMN, lowered to where the author put the
      // payload - so a quote's second line and a fence's body and closer reach
      // it for the same reason the opener did. A fix that admitted the opener
      // alone passes every corpus document above and drops these tails: the
      // quote's `r` lands outside the `dd`, in the list item in the second row.
      expect(carveToHtml(':: t\n:  body\n   > q\n   > r\n')).toBe(
        '<dl>\n  <dt>t</dt>\n  <dd>\n    <p>body</p>\n    <blockquote><p>q\nr</p></blockquote>\n  </dd>\n</dl>',
      )
      expect(carveToHtml('- intro\n\n  :: term\n  :  definition\n   > q\n   > r\n')).toBe(
        '<ul>\n  <li>intro\n    <dl>\n      <dt>term</dt>\n      <dd>definition</dd>\n    </dl>\n    <blockquote><p>q\nr</p></blockquote>\n  </li>\n</ul>',
      )
    })

    it('the same floor applies after a continuation', () => {
      expect(carveToHtml(':: t\n:  body\n   more\n > q\n')).toBe(
        '<dl>\n  <dt>t</dt>\n  <dd>body\nmore</dd>\n</dl>\n<p>&gt; q</p>',
      )
    })
  })
})
