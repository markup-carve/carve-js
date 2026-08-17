import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'
import { expectBuiltInputScansLinearly, perfIt } from './helpers/scaling.js'

/**
 * A `%%%` OPENED INSIDE A CONTAINER IS CLOSED INSIDE THAT CONTAINER
 * (markup-carve/carve-js#1146).
 *
 * The definition prepass decides whether a comment fence opens an opaque region
 * by asking `commentBlockHasCloser`, a document-wide index of the LAST line
 * carrying a `%` run of each width. That is the right question for an opener at
 * document level, where nothing bounds the body but the end of input. It is the
 * wrong one for an opener inside a list item or a quote, which the container
 * bounds - and asking it anyway made a `%%%` written back at column 0 two
 * blocks below count as the closer for an item-scoped fence:
 *
 * ````
 * - item
 *   %%%
 *   hidden
 *
 * [r]: /url
 *
 * %%%
 *
 * [r][]
 * ````
 *
 * The definition between the two delimiters neither registered nor rendered. It
 * was GONE, which is the worse of the two failure modes: an unregistered
 * definition that came back as visible text would at least still be on the
 * page.
 *
 * THE `hidden` LINE IS THE TELL, and it is why "the engine is merely stricter
 * here" is not an available reading. If the indented `%%%` had opened a region
 * reaching the column-0 `%%%`, `hidden` would be inside it and render nothing.
 * It renders. So the region was never opened, so nothing between the delimiters
 * is comment text - and the two halves of the old answer contradicted each
 * other.
 *
 * BOTH KINDS THIS PASS COLLECTS ARE INVOLVED, which is a carve-js-specific
 * detail worth pinning. carve-js registers ABBREVIATIONS in this prepass where
 * carve-rs registers them in the block parser, so a fix keyed on link reference
 * definitions alone would have left half of the report live. The footnote form
 * is unaffected in every engine: `parseFootnoteDef` runs during block parsing,
 * which reads the fence for itself.
 *
 * THE OPPOSITE DIRECTION HAS ROWS TOO. A fix that simply stopped opening
 * item-scoped regions would resolve the report and silently activate every
 * definition an author commented out inside a list item, which is
 * carve-js#634's failure. Every row below that closes INSIDE the container
 * asserts the definition stays hidden.
 *
 * Measured against carve-rs `71318e91` and carve-php `eb787c0`, both built from
 * a fresh `origin/main` worktree, and against the executable spec oracle at the
 * carve pin `8b80822`.
 *
 * TWO NEIGHBORING QUESTIONS ARE DELIBERATELY NOT TOUCHED, and each has a row of
 * its own below stating where carve-js stands:
 *
 *   - whether a quoted `> %%%` with no raw run of its width anywhere in the
 *     document closes a quoted opener. The index that answers first reads RAW
 *     lines and cannot see one, so a definition inside such a comment still
 *     registers even though the quote renders empty. carve-rs and carve-php
 *     answer that exactly as carve-js does and the oracle answers it the other
 *     way - `an-unclosed-comment-fence-hides-no-definition-after-it` pins the
 *     three-engine answer;
 *   - whether a closer with NO blank line above it closes an item-scoped fence.
 *     A column-0 line inside an item is a lazy continuation as far as this pass
 *     can tell, and the row below on lazy dedents is why the bound may not
 *     simply treat one as the container's end.
 */

/** Whether the reference resolved, i.e. whether the definition was collected. */
const resolved = (src: string): boolean => /<a href="\/url">r<\/a>/.test(carveToHtml(src))

describe('a comment fence in a container is closed inside that container', () => {
  it('does not reach a column-0 closer from inside a list item', () => {
    const reported = '- item\n  %%%\n  hidden\n\n[r]: /url\n\n%%%\n\n[r][]\n'
    expect(resolved(reported)).toBe(true)
    // The whole document, not only the resolution: `hidden` renders, which is
    // what makes the two halves consistent with each other.
    expect(carveToHtml(reported)).toBe(
      '<ul>\n  <li>item\n    hidden\n  </li>\n</ul>\n<p><a href="/url">r</a></p>',
    )
  })

  it('does not reach it from an opener on the item marker line either', () => {
    // The marker line records the item's content column while the opener's own
    // raw indent is zero, so a fix measuring the raw indent would miss this one.
    expect(resolved('- %%%\n  hidden\n\n[r]: /url\n\n%%%\n\n[r][]\n')).toBe(true)
  })

  it('does not reach it from inside a block quote', () => {
    // NOT the quoted-closer case: the definition sits at column 0 OUTSIDE the
    // quote. The blank line ends the quote, so the column-0 `%%%` is outside
    // the container the opener was written in.
    expect(resolved('> q\n> %%%\n> hidden\n\n[r]: /url\n\n%%%\n\n[r][]\n')).toBe(true)
  })

  it('collects the ABBREVIATION kind the same way', () => {
    // The kind carve-js registers in this prepass and carve-rs does not, so it
    // needs its own row rather than riding on the link reference above.
    const src = '- item\n  %%%\n  hidden\n\n*[A]: expansion\n\n%%%\n\nA here\n'
    expect(carveToHtml(src)).toContain('<abbr title="expansion">A</abbr>')
  })

  it('a closer one blank line below the item closes nothing either', () => {
    // No second block, just the blank that ends the item - the column-0 run is
    // outside the fence's container and closes nothing. A comment fence does
    // not re-base its closer on the column it opened at, which is where it
    // differs from a code fence, and it is why the container is asked BEFORE
    // the closer here.
    expect(resolved('- item\n  %%%\n  [r]: /url\n\n%%%\n\n[r][]\n')).toBe(true)
  })

  it('a closer with NO blank line above it still closes, which this does not move', () => {
    // The one row of the report this change deliberately leaves where it is.
    // Without a blank line, a column-0 line inside a list item is a LAZY
    // CONTINUATION as far as this pass can tell, and treating a dedent alone as
    // the container's end is what put a definition out of an opaque comment
    // into the link table (codex review, and the row below this one).
    //
    // So the bound stays looser than the container really is, and this document
    // renders as it did before: the region opens, and the definition inside it
    // is neither rendered nor registered. carve-rs `71318e91` and the oracle
    // both register it, so this stays a known divergence rather than a claim.
    expect(resolved('- item\n  %%%\n  [r]: /url\n%%%\n\n[r][]\n')).toBe(false)
  })

  it('a lazy dedent inside the body does not end the container', () => {
    // The direction the bound may never move, and the reason it does not use
    // the plain indentation rule the other trackers in this pass share. The
    // block parser keeps BOTH the dedented line and the definition inside the
    // opaque comment - carve-js renders neither - so a boundary that ended at
    // `x` would decide the fence never closed and publish a definition the
    // author had commented out.
    expect(resolved('- a\n  %%%\n x\n  [r]: /url\n  %%%\n\n[r][]\n')).toBe(false)
    expect(resolved('- a\n  %%%\nx\n  [r]: /url\n  %%%\n\n[r][]\n')).toBe(false)
  })

  it('a fence that DOES close inside the item still hides its body', () => {
    // The direction a fix that merely stopped opening item-scoped regions would
    // break: the definition is commented out and must not reach the link table.
    expect(resolved('- item\n  %%%\n  [r]: /url\n  %%%\n\n[r][]\n')).toBe(false)
    // One item deeper, and with a wider run - the corpus pins both shapes.
    expect(resolved('- a\n  - b\n    %%%\n    [r]: /url\n    %%%\n\n[r][]\n')).toBe(false)
    expect(resolved('- item\n  %%%%\n  [r]: /url\n  %%%%\n\n[r][]\n')).toBe(false)
    // And the abbreviation kind in the same position.
    expect(
      carveToHtml('- item\n  %%%\n  *[A]: expansion\n  %%%\n\nA here\n'),
    ).not.toContain('<abbr')
  })

  it('a document-level fence is unbounded, as it was', () => {
    // The branch that keeps the O(1) index: at document level nothing bounds
    // the body but the end of input, so the far closer really is this opener's.
    expect(resolved('%%%\n[r]: /url\n%%%\n\n[r][]\n')).toBe(false)
    expect(resolved('%%%\nhidden\n\n[r]: /url\n\n%%%\n\n[r][]\n')).toBe(false)
    // And an unterminated one at document level still degrades, so the
    // definition below it is collected.
    expect(resolved('%%%\nhidden\n\n[r]: /url\n\n[r][]\n')).toBe(true)
  })

  it('a differently sized far delimiter was always harmless, and still is', () => {
    // The width probe from the report, kept as a control: it isolated the
    // lookahead as the cause, and it must not change.
    expect(resolved('- item\n  %%%\n  hidden\n\n[r]: /url\n\n%%%%\n\n[r][]\n')).toBe(true)
    expect(resolved('- item\n  %%%\n  hidden\n\n[r]: /url\n\n[r][]\n')).toBe(true)
  })

  it('the two neighboring shapes from the report are unchanged', () => {
    // carve-js was already correct on both, so they are controls: a fix that
    // moved either of them moved something it had no business moving.
    expect(carveToHtml(' %%%\nx\n  %%%\n\n  - [r]: /u\n  %%% tail\n\n[r][]\n')).toBe(
      '<ul>\n  <li></li>\n</ul>\n<p><a href="/u">r</a></p>',
    )
    expect(carveToHtml('  - x\n  %%%\n\n   %%%\n    [r]: /u\n\n[r][]\n')).toBe(
      '<ul>\n  <li>x</li>\n</ul>\n<p>[r]: /u</p>\n<p>[r][]</p>',
    )
  })

  it('a quoted fence with a quoted closer still hides its body', () => {
    // Raised by codex review as a regression of the first attempt, and it was.
    // The scan looked for closers on RAW lines, where a `> %%%` carries its
    // marker and matches nothing, while the far column-0 run got the opener
    // past the width index. So the region found no closer in scope, never
    // opened, and a definition the author had commented out went live.
    //
    // The scan now reads the same container-stripped view the loop that
    // consumes the region closes on, so the two agree line for line.
    expect(resolved('> %%%\n> [r]: /url\n> %%%\n\n%%%\n\n[r][]\n')).toBe(false)
  })

  it('a `+`-attached comment block sits at the marker column, not the item column', () => {
    // The second codex finding. Section 17 lets `+` attach a FLUSH-LEFT block
    // to an item whose content column is two, so the attached comment
    // legitimately continues at column 0. Scoped to the item's column, the
    // blank line inside the attached block reads as the item's end and the
    // commented-out definition goes live.
    expect(resolved('- item\n+\n%%%\n[r]: /url\n\n%%%\n\n[r][]\n')).toBe(false)
    expect(resolved('- item\n+\n%%%\nhidden\n\n[r]: /url\n\n%%%\n\n[r][]\n')).toBe(false)
    // The forms with no blank inside the attachment, and the ones where a blank
    // ends it: unchanged either way, and here as controls.
    expect(resolved('- item\n+\n%%%\n[r]: /url\n%%%\n\n[r][]\n')).toBe(false)
    expect(resolved('- item\n+\n\n%%%\n[r]: /url\n%%%\n\n[r][]\n')).toBe(false)
    expect(resolved('- item\n  +\n\n  %%%\n  [r]: /url\n  %%%\n\n[r][]\n')).toBe(false)
    // And the marker is not a DEPARTURE either. A `+` at column 0 after a blank
    // line attaches the next block to the item rather than ending it, so the
    // closer below the marker is still the fence's own. Read as the boundary,
    // the region never opened and the definition inside it went live while the
    // body above it stayed invisible.
    expect(
      resolved('- item\n  %%%\n  SECRET\n  [r]: /url\n\n+\n  %%%\n\n[r][]\n'),
    ).toBe(false)
  })

  it('an inner container gets its own boundary, not the outer one it follows', () => {
    // The row the boundary memo's KEY needs. The memo remembers a container's
    // boundary and reuses it for the openers that share it, which is what keeps
    // the scan off the hot path - and it is sound only while the scope matches.
    // Here the first opener sits at the outer item's column and its container
    // runs to the end of the document, while the second sits one item deeper
    // and its container ends four lines earlier, at `c`.
    //
    // Reuse the outer boundary for the inner opener and the `    %%%` written
    // AFTER the inner item ended counts as its closer, so the region swallows
    // the definition - the reported bug reintroduced by its own repair. Found
    // by mutating the key away, which nothing else in the suite noticed.
    // carve-rs `71318e91` and the oracle both register it, as this does.
    const nested = '- a\n  %%%\n  y\n  %%%\n  - b\n    %%%\n    [r]: /url\n\n  c\n    %%%\n\n[r][]\n'
    expect(resolved(nested)).toBe(true)
  })

  it('a SIBLING container at the same column gets its own boundary too', () => {
    // The other half of the memo guard, and it fails in the opposite direction.
    // Both openers sit at column 2, so the KEY matches; what differs is that
    // the second is PAST the first one's boundary, in a container of its own
    // that reaches further.
    //
    // Reuse the first boundary here and the second item's fence - which really
    // does close inside its own item - reads as unterminated, so the definition
    // the author commented out registers anyway. carve-rs and the oracle both
    // hide it, as this does.
    const siblings = '- a\n  %%%\n  x\np\n\n- b\n  %%%\n  [r]: /url\n  %%%\n\n[r][]\n'
    expect(resolved(siblings)).toBe(false)
  })

  perfIt('alternating container scopes stay linear too', () => {
    // The memo is keyed BY SCOPE rather than holding one entry, and this is the
    // document that needs it: every unit closes a pair at the outer item's
    // column and a pair one item deeper, so a single-entry memo is evicted on
    // every one of them and each outer opener rescans the rest of the file.
    // Measured at 2000 units: 75ms keyed, 1295ms with one entry (raised by
    // codex review). Each unit is a fixed number of bytes, so the input grows
    // linearly with the unit count and the per-byte reading can see it.
    const alternating = (n: number) =>
      '- a\n' +
      Array.from({ length: n }, () =>
        '  %%%\n  o\n  %%%\n  - b\n    %%%\n    i\n    %%%',
      ).join('\n') +
      '\n'
    expectBuiltInputScansLinearly((input) => void carveToHtml(input), alternating, {
      label: 'alternating outer and inner comment scopes',
      smallRepeats: 300,
    })
  })

  perfIt('a container full of comment openers stays linear in input bytes', () => {
    // The container bound is a SCAN, and a scan per opener is the quadratic
    // shape this pass has been bitten by before. Two guards keep it off the hot
    // path: the width index refutes an opener no closer of its width follows,
    // and the BOUNDARY - which is a function of the line and the scope alone -
    // is remembered across the openers that share it, so one container is
    // walked once between them all rather than once each.
    //
    // This document measures the second guard, and its shape is chosen so the
    // per-byte reading can see it at all. Every opener is the SAME width, so
    // each closes on its successor and none of them is refutable by the width
    // index; the item runs to the end of the document, so every boundary scan
    // that is not remembered walks the whole of it; and each unit is a fixed
    // ten bytes, so the input grows LINEARLY with the opener count. A shape
    // whose openers widen (which is what an unclosable run needs) grows its
    // bytes with the square of the count, and then quadratic work reads as
    // constant cost per byte - the guard would pass through the regression it
    // exists for (raised by codex review).
    //
    // Measured: with the memo, per-byte cost FALLS from 1.54us at 500 units to
    // 0.82us at 2000. Without it, it climbs 5.20us to 15.81us - a ratio of 3.0
    // against a threshold of 2.0.
    const openers = (n: number) =>
      '- item\n' + Array.from({ length: n }, () => '  %%%\n  x').join('\n') + '\n'
    expectBuiltInputScansLinearly((input) => void carveToHtml(input), openers, {
      label: 'comment openers in one item',
      smallRepeats: 500,
    })
  })
})
