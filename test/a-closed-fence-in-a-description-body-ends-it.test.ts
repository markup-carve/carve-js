import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const html = (s: string) => carveToHtml(s).trim()

/**
 * A CLOSED FENCE IN A DESCRIPTION BODY ENDS IT (markup-carve/carve#1930, ported
 * as markup-carve/carve-js#1629).
 *
 * `A FENCED BODY IS NOT A PARAGRAPH` and `FENCE KIND DOES NOT DETERMINE
 * CONTAINER REACH` are both NORMATIVE: S4's lazy branch asks for an OPEN
 * paragraph, and a body whose last block is a CLOSED fence has none, so the
 * flush-left line below is the document's.
 *
 * The column band is the point. `parseDefBody` refused the flush reading for
 * any opener that left a block open, so a fence written one column PAST the
 * body's column never reached the tracker's container arms: `divDepth` stayed
 * 0, the closer was never a closer, and the body ended on prose - holding the
 * paragraph open where the SAME body written AT the column ends it. An answer
 * that moves between the body's column and one past it is reading indentation
 * rather than the rule (carve#1911), so every case here is asked at both.
 */

const AT = 3
const PAST = 4
const pad = (n: number) => ' '.repeat(n)

const DOC = (col: number, body: string[]) =>
  ':: term\n:  definition\n' + body.map((l) => pad(col) + l).join('\n') + '\ntail\n'

describe('a closed fence in a description body ends it', () => {
  for (const [label, col] of [
    ['at the body column', AT],
    ['one past the body column', PAST],
  ] as const) {
    describe(label, () => {
      it('publishes the follower after a closed COLON fence', () => {
        expect(html(DOC(col, ['::: note', 'body', ':::']))).toBe(
          [
            '<dl>',
            '  <dt>term</dt>',
            '  <dd>',
            '    <p>definition</p>',
            '    <aside class="admonition note" aria-label="Note">',
            '      <p>body</p>',
            '    </aside>',
            '  </dd>',
            '</dl>',
            '<p>tail</p>',
          ].join('\n'),
        )
      })

      it('publishes the follower after a closed CODE fence', () => {
        expect(html(DOC(col, ['```', 'c', '```']))).toBe(
          [
            '<dl>',
            '  <dt>term</dt>',
            '  <dd>',
            '    <p>definition</p>',
            '    <pre><code>c',
            '</code></pre>',
            '  </dd>',
            '</dl>',
            '<p>tail</p>',
          ].join('\n'),
        )
      })

      /*
       * CONTROL, and the reason the rule names the CLOSED fence rather than the
       * fence line: an unterminated fence opens no block, so the paragraph above
       * it is still open and the flush-left line folds in. A fix that answered
       * off the fence line alone would move this row too.
       */
      it('keeps the follower inside the body after an UNTERMINATED code fence', () => {
        expect(html(DOC(col, ['```', 'c']))).toContain('tail</code>')
      })

      it('keeps the follower inside the body after an UNTERMINATED colon fence', () => {
        const out = html(DOC(col, ['::: note', 'body']))
        expect(out).toContain('<p>body\ntail</p>')
        expect(out).not.toMatch(/<\/dl>\s*<p>tail<\/p>/)
      })

      /*
       * A `:::` INSIDE A CODE FENCE is payload. Reading it as the colon fence's
       * closer would make the real closer look like an opener and pull the
       * flush-left line back into the body.
       */
      it('steps over a colon run that is code-fence payload', () => {
        expect(html(DOC(col, ['::: note', '```', ':::', '```', ':::']))).toBe(
          [
            '<dl>',
            '  <dt>term</dt>',
            '  <dd>',
            '    <p>definition</p>',
            '    <aside class="admonition note" aria-label="Note">',
            '      <pre><code>:::',
            '</code></pre>',
            '    </aside>',
            '  </dd>',
            '</dl>',
            '<p>tail</p>',
          ].join('\n'),
        )
      })
    })
  }

  /*
   * THE TWO COLUMNS ANSWER ALIKE. Asserted directly rather than left implicit
   * in the pairs above: this is the invariant the defect broke, and it is the
   * one a future change to the flush reading would break again.
   */
  it('answers the same at the body column and one past it', () => {
    for (const body of [
      ['::: note', 'body', ':::'],
      ['```', 'c', '```'],
      ['```', 'c'],
      ['::: note', 'body'],
      ['::: note', '```', ':::', '```', ':::'],
    ]) {
      expect(html(DOC(PAST, body)), body.join(' / ')).toBe(html(DOC(AT, body)))
    }
  })
})
