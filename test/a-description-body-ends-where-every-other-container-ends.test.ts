import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * A DESCRIPTION BODY ENDS WHERE EVERY OTHER CONTAINER ENDS
 * (markup-carve/carve-js#1620, markup-carve/carve-js#1621).
 *
 * Both tickets read carve-js against `spec/scripts/spec/layout.mjs` and
 * reported carve-js as the diverging side. Re-measured, the divergence is
 * real and points the other way: carve-js already gives the answer the
 * committed corpus pins for the sibling hosts, and the oracle's DESCRIPTION
 * BODY arm is the outlier. These rows pin the settled answers so a later
 * alignment pass cannot quietly move them toward the oracle.
 *
 * WHY THE ORACLE IS THE OUTLIER, in one measurement. Sweeping the closed
 * `:::` container across fence columns 0..6 in three hosts, the oracle's
 * block-quote and list-item rows change answer with the column while its
 * description-body row reports the follower INSIDE the `dd` at every column
 * - including column 0, where the fence is not in the body at all. A
 * predicate whose answer never moves with the column is not reading the
 * column: `bodyLeavesParagraphOpen` asks `opensParagraph` about the body's
 * last LINE, and `opensParagraph` has no fence branch, so a bare ``` or `:::`
 * is classified as prose and reports a paragraph open.
 *
 * WHAT SETTLES IT (carve#646, both clauses in resources/spec/01-layout.ebnf).
 * `A FENCED BODY IS NOT A PARAGRAPH` gives S4's lazy branch its parameter -
 * an OPEN PARAGRAPH - and `FENCE KIND DOES NOT DETERMINE CONTAINER REACH`
 * says that parameter is "whether ANY container in the open stack holds an
 * OPEN PARAGRAPH", adding that "a CODE fence body cannot hold an open
 * paragraph at all". A CLOSED fence holds none either way, so the containers
 * close and the flush-left line is a document paragraph. The oracle folds a
 * column-0 line into a `dd` whose last block is a closed CODE block, which
 * that clause forbids in so many words.
 *
 * The corpus pins the same answer for the list-item host at the host's own
 * content column: 270-a-real-div-in-a-container-and-the-flush-left-line-
 * after-it-3, 86-list-lazy-continuation-7 and
 * 367-an-unterminated-fence-at-a-content-column-opens-no-block-so-the-
 * paragraph-stays-open-6. carve-php c2cad3b0 answers as carve-js does on
 * every row below.
 *
 * STILL OPEN, and deliberately not pinned here: PAST the host's content
 * column both carve-js and carve-php keep the follower inside the container
 * after a closed `:::`, where the oracle and the block-quote host eject it.
 * That is a two-engine disagreement with the oracle rather than a settled
 * rule, so it wants its own ruling rather than a golden written from today's
 * behavior.
 */

describe('a closed block at a description body column ends the body (carve-js#1620)', () => {
  it('a closed `:::` container with an empty body', () => {
    expect(carveToHtml(':: term\n:  definition\n   ::: note\n   :::\ntail\n')).toBe(
      '<dl>\n  <dt>term</dt>\n  <dd>\n    <p>definition</p>\n    <aside class="admonition note" aria-label="Note">\n\n    </aside>\n  </dd>\n</dl>\n<p>tail</p>',
    )
  })

  it('a closed `:::` container that carried a body', () => {
    expect(carveToHtml(':: term\n:  definition\n   ::: note\n   body\n   :::\ntail\n')).toBe(
      '<dl>\n  <dt>term</dt>\n  <dd>\n    <p>definition</p>\n    <aside class="admonition note" aria-label="Note">\n      <p>body</p>\n    </aside>\n  </dd>\n</dl>\n<p>tail</p>',
    )
  })

  it('a closed CODE fence, which cannot hold an open paragraph at all', () => {
    expect(carveToHtml(':: term\n:  definition\n   ```\n   c\n   ```\ntail\n')).toBe(
      '<dl>\n  <dt>term</dt>\n  <dd>\n    <p>definition</p>\n    <pre><code>c\n</code></pre>\n  </dd>\n</dl>\n<p>tail</p>',
    )
  })

  it('the list-item host answers alike [corpus 270-...-3]', () => {
    expect(carveToHtml('- item\n  ::: note\n  body\n  :::\ntail\n')).toBe(
      '<ul>\n  <li>item\n    <aside class="admonition note" aria-label="Note">\n      <p>body</p>\n    </aside>\n  </li>\n</ul>\n<p>tail</p>',
    )
  })

  it('the list-item host answers alike for a code fence too [corpus 86-list-lazy-continuation-7]', () => {
    expect(carveToHtml('- item\n  ```\n  c\n  ```\ntail\n')).toBe(
      '<ul>\n  <li>item\n    <pre><code>c\n</code></pre>\n  </li>\n</ul>\n<p>tail</p>',
    )
  })

  it('an EMPTY unterminated container also ends at a flush-left line (carve-js#1641)', () => {
    // Superseded carve-js#1613: an empty unterminated admonition no longer
    // keeps its flush-left follower - it ends like a closed one, and `tail` is
    // a document paragraph. Pinned as corpus
    // 452-an-empty-unterminated-container-ends-at-a-flush-left-line.
    expect(carveToHtml(':: term\n:  definition\n   ::: note\ntail\n')).toBe(
      '<dl>\n  <dt>term</dt>\n  <dd>\n    <p>definition</p>\n    <aside class="admonition note" aria-label="Note">\n\n    </aside>\n  </dd>\n</dl>\n<p>tail</p>',
    )
  })
})

describe('a comment fence at column 0 below a description body opens a block (carve-js#1621)', () => {
  /*
   * CARVE-P2-017 puts the line in the SURVIVING CONTEXT: "BELOW the body's
   * content column, the body ENDS and the line is classified in the surviving
   * context", and "At DOCUMENT column 0 they are interrupters and the body
   * does end". The surviving context here is the document, where a `%%%` with
   * a matching run below it is a comment BLOCK - nothing scopes that closer
   * away. Corpus 214-a-comment-fence-at-column-0-ends-the-item-a-line-does-not
   * pins the identical rule for the list-item host, and the oracle's own item
   * collector records it as unanimous: "A comment FENCE AT THE FRAME'S COLUMN
   * 0 ends the item: all three engines give the following line to the
   * enclosing block, while an INDENTED fence stays with the item".
   */
  it('the reported document: the fence opens, and the line between the runs is hidden', () => {
    expect(carveToHtml(':: t\n:  x\n%%%\ny\n%%%\nz\n')).toBe(
      '<dl>\n  <dt>t</dt>\n  <dd>x</dd>\n</dl>\n<p>z</p>',
    )
  })

  it('the width does not matter', () => {
    expect(carveToHtml(':: t\n:  x\n%%%%\ny\n%%%%\nz\n')).toBe(
      '<dl>\n  <dt>t</dt>\n  <dd>x</dd>\n</dl>\n<p>z</p>',
    )
  })

  it('one column in, still below the body column', () => {
    expect(carveToHtml(':: t\n:  x\n %%%\ny\n %%%\nz\n')).toBe(
      '<dl>\n  <dt>t</dt>\n  <dd>x</dd>\n</dl>\n<p>z</p>',
    )
  })

  it('the list-item host answers alike [corpus 214]', () => {
    expect(carveToHtml('- a\n%%%\nc\n%%%\nb\n')).toBe('<ul>\n  <li>a</li>\n</ul>\n<p>b</p>')
  })

  it('AT the body column the fence finds no closer and degrades [control]', () => {
    // The body ends at `y`, so the closer is not in the body and the opener is
    // a line comment; the indented closer is one too. Both lines publish.
    expect(carveToHtml(':: t\n:  x\n   %%%\ny\n   %%%\nz\n')).toBe(
      '<dl>\n  <dt>t</dt>\n  <dd>x</dd>\n</dl>\n<p>y</p>\n<p>z</p>',
    )
  })

  it('an unterminated fence at column 0 is a line comment [control]', () => {
    expect(carveToHtml(':: t\n:  x\n%%%\ny\nz\n')).toBe(
      '<dl>\n  <dt>t</dt>\n  <dd>x</dd>\n</dl>\n<p>y\nz</p>',
    )
  })

  it('the `%%` line form is invisible and opens nothing [control]', () => {
    expect(carveToHtml(':: t\n:  x\n%% c\nz\n')).toBe(
      '<dl>\n  <dt>t</dt>\n  <dd>x</dd>\n</dl>\n<p>z</p>',
    )
  })
})
