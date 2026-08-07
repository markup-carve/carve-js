import { describe, it, expect } from 'vitest'
import { carveToHtml, lintCarve } from '../src/index.js'

/**
 * PART 9R R1: the heading index is keyed by each heading's RENDERED PLAIN TEXT,
 * and the LABEL enters that comparison as its rendered plain text too - its
 * inline markup stripped exactly as the heading's was (markup-carve/carve#949,
 * markup-carve/carve-js#843).
 *
 * `# *bold* heading` is registered as `bold heading`, so without the strip no
 * heading containing emphasis, a code span or a link is reachable by its
 * collapsed spelling at all, and the author sees no reason why. carve-rs,
 * carve-php and the executable spec all resolved it; this engine did not.
 *
 * THE STRIP IS SCOPED TO THE HEADING INDEX, and that is a hard boundary.
 * `linkDefs` matching keys on the label AS WRITTEN and does not move.
 * markup-carve/carve-php#768 is the cautionary precedent: it generalized this
 * into stripping markup from every collapsed label and inverted that rule in
 * both directions.
 */

/** The href a document's first link resolves to, or null. */
const href = (src: string): string | null => /<a href="([^"]*)"/.exec(carveToHtml(src))?.[1] ?? null

/** Every inline markup kind a heading can carry. */
const MARKUPS = [
  '*bold* heading',
  '/italic/ heading',
  '`code()` heading',
  '_underline_ heading',
  '~strike~ heading',
  '=highlight= heading',
  '[link](/u) heading',
  '[span]{.c} heading',
  '{^sup^} heading',
  '{,sub,} heading',
  '*/nested/* heading',
]

describe('a collapsed reference reaches a heading by its rendered text', () => {
  it('resolves an emphasized heading', () => {
    expect(carveToHtml('# *bold* heading\n\n[*bold* heading][]\n')).toBe(
      '<section id="bold-heading">\n  <h1><strong>bold</strong> heading</h1>\n  <p><a href="#bold-heading"><strong>bold</strong> heading</a></p>\n</section>',
    )
  })

  it('resolves a code-span heading', () => {
    // The row a FIXED-CHARACTER-LIST strip fails: `code()` loses its backticks
    // but keeps its parentheses, so the key is `code heading` only if the label
    // was really parsed.
    expect(carveToHtml('# `code()` heading\n\n[`code()` heading][]\n')).toBe(
      '<section id="code-heading">\n  <h1><code>code()</code> heading</h1>\n  <p><a href="#code-heading"><code>code()</code> heading</a></p>\n</section>',
    )
  })

  it('resolves every inline markup kind, not the two the report showed', () => {
    const unresolved = MARKUPS.filter((m) => href('# ' + m + '\n\n[' + m + '][]\n') === null)
    expect(unresolved).toEqual([])
  })

  it('CONTROL a heading with NO markup still resolves', () => {
    // Without it the retry could be doing all the work and the as-written
    // lookup could have been deleted.
    expect(href('# plain heading\n\n[plain heading][]\n')).toBe('#plain-heading')
  })

  it('CONTROL linkDefs still key on the label AS WRITTEN', () => {
    // Both directions of corpus category 193, which this engine already passed
    // and which a generalized strip inverts.
    expect(href('[*bold*]: /x\n\n[*bold*][]\n')).toBe('/x')
    expect(href('[bold]: /x\n\n[*bold*][]\n')).toBe(null)
    expect(href('[*bold*]: /x\n\n[bold][]\n')).toBe(null)
  })

  it('CONTROL the tie-break is unaffected: linkDefs still beats a same-named heading', () => {
    // Corpus 275-3, on the NEW path: the heading is now reachable, and the
    // definition still wins.
    expect(carveToHtml('[*bold* heading]: /x\n\n# *bold* heading\n\n[*bold* heading][]\n')).toBe(
      '<section id="bold-heading">\n  <h1><strong>bold</strong> heading</h1>\n  <p><a href="/x"><strong>bold</strong> heading</a></p>\n</section>',
    )
  })

  it('prefers the heading whose text literally CONTAINS the markup characters', () => {
    // The as-written key is tried first, so a heading written with the
    // characters as text beats one that only matches after the strip. Both
    // headings exist here; the literal one is the answer.
    const out = carveToHtml('# `*bold* heading`\n\n# bold heading\n\n[*bold* heading][]\n')
    // The literal heading's slug is `bold-heading`; the plain one dedups to
    // `bold-heading-1`. The reference must take the first.
    expect(/<a href="([^"]*)"/.exec(out)?.[1]).toBe('#bold-heading')
  })

  it("applies R1's four normalizations to the stripped plain text", () => {
    // The strip produces a string that still has to be trimmed, whitespace-
    // collapsed, NFC'd and case-folded. A retry that skipped them passes every
    // case above, because those labels need no normalizing.
    // Case and a collapsed run:
    expect(href('# *bold*  heading\n\n[*BOLD*   heading][]\n')).toBe('#bold-heading')
    // NFC: the heading writes the composed form, the label the decomposed one.
    // The id keeps the accent (§25 NFC, case-preserving), so the composed
    // form is what the reference must reach.
    expect(href('# *caf\u00e9* heading\n\n[*cafe\u0301* heading][]\n')).toBe('#caf\u00e9-heading')
    // CONTROL: a label that differs by more than normalization still misses.
    expect(href('# *bold* heading\n\n[*bolder* heading][]\n')).toBe(null)
  })

  it('CONTROL a heading inside a blockquote is still not indexed', () => {
    expect(href('> # *b* h\n\n[*b* h][]\n')).toBe(null)
  })

  it('lint agrees with the resolver', () => {
    // The mirror in `lint.ts` builds the same index and asks the same
    // question; checking only the as-written key made it report a reference
    // that resolves as unresolved.
    expect(lintCarve('# *bold* heading\n\n[*bold* heading][]\n')).toEqual([])
    // CONTROL: a label that really has no target is still reported.
    expect(lintCarve('# *bold* heading\n\n[*other* heading][]\n').map((w) => w.rule)).toEqual([
      'unresolved-reference-link',
    ])
  })

  it('derives the label key with the SAME function the heading side uses', () => {
    // Raised by codex review: a label carrying a construct `inlineText` drops -
    // a footnote reference - now matches a heading without it.
    //
    // That is the clause, not a deviation from it. R1 says the label enters as
    // "the same string kind the heading side already enters as", and a footnote
    // reference contributes nothing to a HEADING's key either: `# [^x] heading`
    // is keyed `heading` too. Deriving the label key with a DIFFERENT function
    // than the heading side is what would break the symmetry the clause states.
    const withFootnoteInLabel = '[^x]: note\n\n# heading\n\n[[^x] heading][]\n'
    const withFootnoteInBoth = '[^x]: note\n\n# [^x] heading\n\n[[^x] heading][]\n'
    expect(href(withFootnoteInLabel)).toBe('#heading')
    expect(href(withFootnoteInBoth)).toBe('#heading')

    // The resulting anchor nests, and that is a PRE-EXISTING defect of a
    // footnote reference inside any link label rather than anything this rule
    // introduces - an ordinary inline link with the same label nests
    // identically, on this build and on the one before it. Pinned here so the
    // day it is fixed, this row moves with it instead of being discovered.
    const nests = (src: string) => /<a [^>]*>(?:(?!<\/a>)[\s\S])*<a /.test(carveToHtml(src))
    expect(nests('[^x]: note\n\n[see [^x] here](/u)\n')).toBe(true)
    expect(nests(withFootnoteInLabel)).toBe(true)

    // CONTROL: a nested LINK is unwrapped, which is the rule that construct
    // does have, so the two are not the same case.
    expect(carveToHtml('# [a](/u) heading\n\n[[a](/u) heading][]\n')).toContain(
      '<a href="#a-heading">a heading</a>',
    )
  })

  it('a FULL reference does NOT reach the index at any spelling', () => {
    // THE EXPLICIT FORM DOES NOT REACH THE INDEX (PART 9R R1,
    // markup-carve/carve#742). This row used to expect the opposite, on the
    // reading that R1's key function serves both spellings. R1 now scopes the
    // fallback to the collapsed `[text][]` and to nothing else, and the
    // asymmetry it already stated is the reason: an explicit label is an
    // identifier the author wrote twice and can keep identical, so an
    // identifier that names nothing names nothing and is not retried as prose.
    // (`[link](/u)` and `[span]{.c}` are unreachable as full-reference labels
    // for an unrelated reason - the label production stops at the first `]`.)
    const bracketFree = MARKUPS.filter((m) => !m.includes('['))
    const resolved = bracketFree.filter((m) => href('# ' + m + '\n\n[see][' + m + ']\n') !== null)
    expect(resolved).toEqual([])
  })
})
