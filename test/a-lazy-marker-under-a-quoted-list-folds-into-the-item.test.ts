import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * AN UNMARKED LIST MARKER UNDER A QUOTED LIST FOLDS (markup-carve/carve#1904).
 *
 * PART 0 LAZY CONTINUATION, `resources/grammar.ebnf`, NORMATIVE: a line that
 * carries no `>` still continues the quote, folding into the INNERMOST open
 * paragraph at whatever depth that paragraph sits, and a list marker is
 * explicitly NOT one of the exclusions that end the quote. Where the quote's
 * trailing block is a LIST, the innermost open paragraph is the open item's -
 * so `> - a` / `- m` is one quote whose item paragraph is `a\n- m`.
 *
 * The quote collected the line correctly and then handed it to its own
 * sub-parse, which read the marker a SECOND time and opened an item inside the
 * quote for a line carrying no `>`. Under no reading is the line inside the
 * quote as a block: it either folds (the clause) or ends the quote. Three
 * engines produced that third answer, which is why the tracker is filed against
 * all of them; this is the carve-js half.
 *
 * TWO CONSULT SITES, AND THEY ANSWER DIFFERENT COLUMNS. At column 0 the quote's
 * sub-parse takes the marker as a SIBLING item, and `lazyContinuationEndsList`
 * is what said so. At or past the quoted item's content column it takes it as a
 * SUBLIST, and that decision is the item collector's content-column arm, which
 * dedents the line to the body's column 0 where §24 C3 opens one. Fixing either
 * alone leaves the other band wrong - the mutation proof in the pull request
 * kills them separately.
 *
 * ORACLE. `spec/scripts/spec/layout.mjs` into `spec/scripts/spec/html.mjs` at
 * the pinned submodule (549f2a52), which for this family is byte-identical to
 * spec main: the two disagree on 503 of 4496 sweep documents and every one of
 * them carries a COMMENT payload (markup-carve/carve#1902's quote-host
 * exemption), while all 562 documents carrying a `- m` payload agree.
 *
 * THE BAND LEFT ALONE. markup-carve/carve#1905 is open on the shape where the
 * unmarked line reaches an ENCLOSING ITEM's content column - `- a` / `  > - x`
 * / `  - m`. There §24 C3 also speaks and the clauses point two ways, so it
 * wants a ruling rather than an engine fix. An unmarked line can never be
 * inside anything under a `>`, so the columns it can reach are exactly those of
 * items OUTSIDE the quote; the fix is held back there and nowhere else, and the
 * last block below pins that the answer did not move.
 */

describe('a lazy marker under a quoted list folds into the open item', () => {
  it('folds a bullet, and the tail below it', () => {
    expect(carveToHtml('> - a\n- m\ntail\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>a\n- m\ntail</li>\n  </ul>\n</blockquote>',
    )
  })

  it('folds an ordered marker', () => {
    expect(carveToHtml('> - a\n1. m\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>a\n1. m</li>\n  </ul>\n</blockquote>',
    )
  })

  it('folds a task marker', () => {
    expect(carveToHtml('> - a\n- [ ] m\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>a\n- [ ] m</li>\n  </ul>\n</blockquote>',
    )
  })

  it('folds an abutting-attribute marker', () => {
    expect(carveToHtml('> - a\n-{.k} m\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>a\n-{.k} m</li>\n  </ul>\n</blockquote>',
    )
  })

  it('folds under an ORDERED quoted list too', () => {
    expect(carveToHtml('> 1. a\n- m\n')).toBe(
      '<blockquote>\n  <ol>\n    <li>a\n- m</li>\n  </ol>\n</blockquote>',
    )
  })

  it('folds AT the quoted item content column, where a sublist used to open', () => {
    expect(carveToHtml('> - a\n  - m\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>a\n- m</li>\n  </ul>\n</blockquote>',
    )
  })

  it('folds PAST the quoted item content column', () => {
    expect(carveToHtml('> - a\n    - m\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>a\n- m</li>\n  </ul>\n</blockquote>',
    )
  })

  it('folds into the list inside a NESTED quote', () => {
    expect(carveToHtml('> > - a\n- m\n')).toBe(
      '<blockquote>\n  <blockquote>\n    <ul>\n      <li>a\n- m</li>\n    </ul>\n  </blockquote>\n</blockquote>',
    )
  })
})

describe('what the fold does not reach', () => {
  it('a PARAGRAPH trailing block folds as it always did', () => {
    expect(carveToHtml('> a\n- m\n')).toBe('<blockquote><p>a\n- m</p></blockquote>')
  })

  it('a HEADING trailing block still ends the quote - the clause names it', () => {
    expect(carveToHtml('> # h\n- m\n')).toBe(
      '<blockquote>\n  <h1 id="h">h</h1>\n</blockquote>\n<ul>\n  <li>m</li>\n</ul>',
    )
  })

  it('a TABLE trailing block still ends the quote', () => {
    expect(carveToHtml('> | a |\n> | - |\n- m\n')).toBe(
      '<blockquote>\n  <table>\n    <thead>\n      <tr><th scope="col">a</th></tr>\n    </thead>\n  </table>\n</blockquote>\n<ul>\n  <li>m</li>\n</ul>',
    )
  })

  it('a blank line closed the quote, so the marker opens a list outside it', () => {
    expect(carveToHtml('> - a\n\n- m\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>a</li>\n  </ul>\n</blockquote>\n<ul>\n  <li>m</li>\n</ul>',
    )
  })

  it('a marker that CARRIES the quote marker is a real sibling item', () => {
    expect(carveToHtml('> - a\n> - m\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>a</li>\n    <li>m</li>\n  </ul>\n</blockquote>',
    )
  })
})

describe('the band markup-carve/carve#1905 is open on does not move', () => {
  // Each of these puts the unmarked line on an ENCLOSING ITEM's content column,
  // which is the one place §24 C3 has something to say. The answers below are
  // what carve-js produced BEFORE this change, pinned so the fix cannot reach
  // them by accident; they are NOT the oracle's, and the ticket decides which
  // of the three answers is right.
  it('a quote below the item lead keeps its sibling item', () => {
    expect(carveToHtml('- a\n  > - x\n  - m\n')).toBe(
      '<ul>\n  <li>a\n    <blockquote>\n      <ul>\n        <li>x</li>\n        <li>m</li>\n      </ul>\n    </blockquote>\n  </li>\n</ul>',
    )
  })

  it('one quote deeper keeps it too - the hold-back travels', () => {
    expect(carveToHtml('- a\n  > > - x\n  - m\n')).toBe(
      '<ul>\n  <li>a\n    <blockquote>\n      <blockquote>\n        <ul>\n          <li>x</li>\n          <li>m</li>\n        </ul>\n      </blockquote>\n    </blockquote>\n  </li>\n</ul>',
    )
  })

  it('a quote ON the item lead keeps it - same column, same band', () => {
    expect(carveToHtml('- > - a\n  - m\n')).toBe(
      '<ul>\n  <li>\n    <blockquote>\n      <ul>\n        <li>a</li>\n        <li>m</li>\n      </ul>\n    </blockquote>\n  </li>\n</ul>',
    )
  })

  it('two items deep, at the inner item content column', () => {
    expect(carveToHtml('- - > - a\n    - m\n')).toBe(
      '<ul>\n  <li>\n    <ul>\n      <li>\n        <blockquote>\n          <ul>\n            <li>a</li>\n            <li>m</li>\n          </ul>\n        </blockquote>\n      </li>\n    </ul>\n  </li>\n</ul>',
    )
  })
})
