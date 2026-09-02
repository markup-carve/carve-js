import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * A DESCRIPTION BODY UNDER A QUOTED ITEM IS THE BODY, NOT THE TERM
 * (markup-carve/carve-js#1606; carve-rs carries the same defect as
 * markup-carve/carve-rs#1526).
 *
 * PART 0 LAZY CONTINUATION: a line carrying no `>` still continues the quote by
 * folding into the innermost open paragraph, and it is not the quote's content
 * at any column - its indentation inside the quote body means nothing, because
 * the quote is reached by its marker and never by a column. The item collector
 * read it by column anyway: `> - :: t` puts the item's content column at 4, a
 * `:  a` written there reached it, and the content-column arm dedented by the
 * item's own column and left the rest as leading indent. An indented `:` is no
 * longer a description marker, so the body folded into the term - while the
 * same document without the quote read the body. The quote prefix was the whole
 * difference, which is what localized the fault.
 *
 * The lazy arm strips the indent instead, which is PART 9 §24 C3's LENIENT
 * def-list entry: a `:` attaches a fresh description to an open term from at or
 * below column 0. That arm already existed for a below-column line; all this
 * change does is send the quote's lazy line to it.
 *
 * ONE STATE IS EXCLUDED: a description body already open, where the same line
 * is that body's own lazy continuation rather than a second entry. That is the
 * one place the oracle's two collectors differ - the term's fold tests for an
 * entry AFTER unframing a lazy line, the body's fold tests before it.
 *
 * ORACLE. `spec/scripts/spec/layout.mjs` into `spec/scripts/spec/html.mjs` at
 * the PINNED submodule (549f2a52). Checked against spec main (95fc3a04) as
 * well, because the pin predates markup-carve/carve#1902's quote-host fix: over
 * a 4480-document sweep the two revisions disagree on 98 documents and every
 * one of them carries a COMMENT payload, while all 672 documents carrying a
 * `:` description payload agree. Both revisions score this change identically -
 * 102 documents move onto the oracle's answer, none away from it - so the pin
 * does not matter here. carve-php reads the shape correctly already, per the
 * ticket's own measurement; nothing here re-ran it.
 *
 * WHAT DOES NOT MOVE. The change is gated on three things at once: the line
 * reached here as the QUOTE's lazy text, no description body is open, and the
 * flush line is a `:` DESCRIPTION marker. The last two describes pin those
 * gates from outside - a line that carries its `>`, a line under an open
 * description, and a non-description payload at the same column. Three of the
 * final block's five expectations - the list marker, the heading and the plain
 * prose - are pre-existing divergences from the oracle that this change
 * deliberately leaves where they are; the other two already agreed with it.
 *
 * The SHAPE gate is a deliberate scope limit rather than a rule: every
 * quote-lazy line has no column here, but sending them all down the lazy arm
 * also moved 22 fence-shaped documents OFF the oracle's answer, so the general
 * port wants its own measurement and its own ticket.
 */

const QUOTED_DD =
  '<blockquote>\n  <ul>\n    <li>\n      <dl>\n        <dt>t</dt>\n' +
  '        <dd>a\ntail</dd>\n      </dl>\n    </li>\n  </ul>\n</blockquote>'

describe('a description written past a quoted item content column opens the body', () => {
  it('reads the ticket document', () => {
    expect(carveToHtml('> - :: t\n    :  a\ntail\n')).toBe(QUOTED_DD)
  })

  it('reads it AT the item content column, where it always worked', () => {
    expect(carveToHtml('> - :: t\n  :  a\ntail\n')).toBe(QUOTED_DD)
  })

  it('reads it at column 0, where it always worked', () => {
    expect(carveToHtml('> - :: t\n:  a\ntail\n')).toBe(QUOTED_DD)
  })

  it('reads it far past the column - a lazy line has no column at all', () => {
    expect(carveToHtml('> - :: t\n      :  a\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>\n      <dl>\n        <dt>t</dt>\n        <dd>a</dd>\n      </dl>\n    </li>\n  </ul>\n</blockquote>',
    )
  })

  it('reads a one-space separator', () => {
    expect(carveToHtml('> - :: t\n    : a\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>\n      <dl>\n        <dt>t</dt>\n        <dd>a</dd>\n      </dl>\n    </li>\n  </ul>\n</blockquote>',
    )
  })

  it('reads a three-space separator', () => {
    expect(carveToHtml('> - :: t\n    :   a\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>\n      <dl>\n        <dt>t</dt>\n        <dd>a</dd>\n      </dl>\n    </li>\n  </ul>\n</blockquote>',
    )
  })

  it('reads it under an ORDERED quoted item', () => {
    expect(carveToHtml('> 1. :: t\n     :  a\n')).toBe(
      '<blockquote>\n  <ol>\n    <li>\n      <dl>\n        <dt>t</dt>\n        <dd>a</dd>\n      </dl>\n    </li>\n  </ol>\n</blockquote>',
    )
  })

  it('reads it one quote deeper', () => {
    expect(carveToHtml('> > - :: t\n      :  a\n')).toBe(
      '<blockquote>\n  <blockquote>\n    <ul>\n      <li>\n        <dl>\n          <dt>t</dt>\n          <dd>a</dd>\n        </dl>\n      </li>\n    </ul>\n  </blockquote>\n</blockquote>',
    )
  })

  it('reads it one item deeper', () => {
    expect(carveToHtml('> - - :: t\n      :  a\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>\n      <ul>\n        <li>\n          <dl>\n            <dt>t</dt>\n            <dd>a</dd>\n          </dl>\n        </li>\n      </ul>\n    </li>\n  </ul>\n</blockquote>',
    )
  })
})

describe('the three gates, pinned from outside', () => {
  it('a description that CARRIES its `>` is the quote content it looks like, and keeps its column', () => {
    // Not lazy: the line supplies the prefix, so its column inside the quote is
    // real and an over-indented `:` is term continuation. Gate: quoteLazyLines.
    expect(carveToHtml('> - :: t\n>     :  a\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>\n      <dl>\n        <dt>t\n  :  a</dt>\n      </dl>\n    </li>\n  </ul>\n</blockquote>',
    )
  })

  it('a line under an OPEN description continues that body, not a second one', () => {
    // Gate: lazyState.inDefList !== 'description'. The leniency is written
    // against an open TERM; here the `<dd>` is open and owns the line.
    expect(carveToHtml('> - :: t\n> :  d\n   :  b\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>\n      <dl>\n        <dt>t</dt>\n        <dd>d\n:  b</dd>\n      </dl>\n    </li>\n  </ul>\n</blockquote>',
    )
  })

  it('it continues that body from far past the column too', () => {
    expect(carveToHtml('> - :: t\n> :  d\n      :  b\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>\n      <dl>\n        <dt>t</dt>\n        <dd>d\n:  b</dd>\n      </dl>\n    </li>\n  </ul>\n</blockquote>',
    )
  })

  it('an item holding no def list at all folds the same line as text', () => {
    // No body is open, so the arm fires and the line is columnless - which for
    // an item whose lead leaves a paragraph open is the same fold as before.
    expect(carveToHtml('> - a\n    :  b\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>a\n:  b</li>\n  </ul>\n</blockquote>',
    )
  })

  it('...and ends the item where its lead leaves no paragraph open', () => {
    // The columnless line reaches no content column, so a table lead ends the
    // item and the description is a paragraph in the quote - which is the
    // oracle's answer, and one carve-js used to miss.
    expect(carveToHtml('> - | a |\n  :  b\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>\n      <table>\n        <tbody>\n          <tr><td>a</td></tr>\n        </tbody>\n      </table>\n    </li>\n  </ul>\n  <p>:  b</p>\n</blockquote>',
    )
  })

  it('an unquoted item reads the same columns exactly as before', () => {
    // No quote, so no lazy line: the payload reaches the item content column
    // for real and the residue is term continuation. This is the control the
    // ticket used to localize the fault to the quote prefix.
    expect(carveToHtml('- :: t\n    :  a\ntail\n')).toBe(
      '<ul>\n  <li>\n    <dl>\n      <dt>t\n  :  a\ntail</dt>\n    </dl>\n  </li>\n</ul>',
    )
  })

  it('a blank line closed the quote, so the description is a paragraph outside it', () => {
    expect(carveToHtml('> - :: t\n\n    :  a\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>\n      <dl>\n        <dt>t</dt>\n      </dl>\n    </li>\n  </ul>\n</blockquote>\n<p>:  a</p>',
    )
  })
})

describe('a non-description payload at the same column does not move', () => {
  // Gate: RE_DEFLIST_DEF. Every expectation here is what carve-js produced
  // BEFORE this change. The marker, the heading and the plain prose diverge from
  // the oracle, which folds all three into the term; they are pinned so the fix
  // cannot reach them by accident, not endorsed. The fence and the second term
  // already agree with it.
  it('a list marker keeps the sublist it opened', () => {
    expect(carveToHtml('> - :: t\n    - m\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>\n      <dl>\n        <dt>t</dt>\n      </dl>\n      <ul>\n        <li>m</li>\n      </ul>\n    </li>\n  </ul>\n</blockquote>',
    )
  })

  it('a heading keeps the heading it opened', () => {
    expect(carveToHtml('> - :: t\n    # h\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>\n      <dl>\n        <dt>t</dt>\n      </dl>\n      <h1 id="h">h</h1>\n    </li>\n  </ul>\n</blockquote>',
    )
  })

  it('an unterminated fence stays the inline verbatim run that swallows the tail', () => {
    expect(carveToHtml('> - :: t\n    ```\ntail\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>\n      <dl>\n        <dt>t\n<code>\ntail</code></dt>\n      </dl>\n    </li>\n  </ul>\n</blockquote>',
    )
  })

  it('a second TERM keeps opening a second term', () => {
    expect(carveToHtml('> - :: t\n    :: t2\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>\n      <dl>\n        <dt>t</dt>\n        <dt>t2</dt>\n      </dl>\n    </li>\n  </ul>\n</blockquote>',
    )
  })

  it('plain prose keeps its residual indent in the term', () => {
    expect(carveToHtml('> - :: t\n    plain\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>\n      <dl>\n        <dt>t\n  plain</dt>\n      </dl>\n    </li>\n  </ul>\n</blockquote>',
    )
  })
})
