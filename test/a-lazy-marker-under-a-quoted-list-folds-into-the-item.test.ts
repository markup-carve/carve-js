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
 * THE ENCLOSING-COLUMN BAND FOLDS TOO, ruled on markup-carve/carve#1905 and
 * ported here (carve-js#1615). `- a` / `  > - x` / `  - m` puts the unmarked
 * line on the enclosing item's content column, and §24 C3 was read as speaking
 * there. It does not: A QUOTE IS REACHED BY ITS MARKER, AND A COLUMN NEVER
 * REACHES INTO ONE (`01-layout.ebnf:330`), so a line writing no `>` is in no
 * quote whatever column it lands on and only PART 0's lazy fold touches it.
 * The paragraph twin already folded at that column in every reader; this makes
 * the marker twin agree with it. The last block below pins the band and the
 * controls that bound it.
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

describe('an unmarked marker at an enclosing item content column folds', () => {
  // Each of these puts the unmarked line on an ENCLOSING ITEM's content column.
  // The answers are the executable spec's, at spec main `1a50d213`.
  it('a quote below the item lead', () => {
    expect(carveToHtml('- a\n  > - x\n  - m\n')).toBe(
      '<ul>\n  <li>a\n    <blockquote>\n      <ul>\n        <li>x\n- m</li>\n      </ul>\n    </blockquote>\n  </li>\n</ul>',
    )
  })

  it('one quote deeper', () => {
    expect(carveToHtml('- a\n  > > - x\n  - m\n')).toBe(
      '<ul>\n  <li>a\n    <blockquote>\n      <blockquote>\n        <ul>\n          <li>x\n- m</li>\n        </ul>\n      </blockquote>\n    </blockquote>\n  </li>\n</ul>',
    )
  })

  it('a quote ON the item lead - the marker-lead spelling', () => {
    expect(carveToHtml('- > - a\n  - m\n')).toBe(
      '<ul>\n  <li>\n    <blockquote>\n      <ul>\n        <li>a\n- m</li>\n      </ul>\n    </blockquote>\n  </li>\n</ul>',
    )
  })

  it('two items deep, at the inner item content column', () => {
    expect(carveToHtml('- - > - a\n    - m\n')).toBe(
      '<ul>\n  <li>\n    <ul>\n      <li>\n        <blockquote>\n          <ul>\n            <li>a\n- m</li>\n          </ul>\n        </blockquote>\n      </li>\n    </ul>\n  </li>\n</ul>',
    )
  })

  // CONTROLS. A blank line is the only exit, and with no quote above it the
  // marker opens an item as it always has.
  it('control: a blank line escapes the quote', () => {
    expect(carveToHtml('- a\n  > - x\n\n  - m\n')).toBe(
      '<ul>\n  <li>a\n    <blockquote>\n      <ul>\n        <li>x</li>\n      </ul>\n    </blockquote>\n    <ul>\n      <li>m</li>\n    </ul>\n  </li>\n</ul>',
    )
  })

  it('control: the paragraph twin, which already folded', () => {
    expect(carveToHtml('- a\n  > q\n  - m\n')).toBe(
      '<ul>\n  <li>a\n    <blockquote><p>q\n- m</p></blockquote>\n  </li>\n</ul>',
    )
  })

  it('control: no quote, a sibling item above', () => {
    expect(carveToHtml('- a\n  - b\n  - m\n')).toBe(
      '<ul>\n  <li>a\n    <ul>\n      <li>b</li>\n      <li>m</li>\n    </ul>\n  </li>\n</ul>',
    )
  })
})
