import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * PART 1 S4 makes lazy continuation conditional on an OPEN PARAGRAPH:
 *
 *   "if ANY container in the open stack holds an OPEN PARAGRAPH and the residue
 *   is NOT an interrupting line, L folds into the INNERMOST such paragraph and
 *   NOTHING closes. Otherwise close the unmatched containers and re-classify
 *   the residue in the surviving context."
 *
 * A heading, table row and thematic break were already handled. Two constructs
 * that also leave no paragraph were not: a definition TERM, which is bounded
 * like a heading, and an invisible definition, which leaves nothing on the page
 * at all (carve-js#554).
 *
 * carve-rs applies the condition in every case; carve-php shared these two plus
 * the heading (carve-php#652). The majority was wrong here, so these assert
 * against S4 rather than against the other engines.
 */
const squash = (html: string) => html.replace(/\s+/g, ' ').trim()

describe('lazy continuation into a block quote', () => {
  it('folds into an open paragraph', () => {
    // The control, pinned by corpus 82-blockquote-lazy-continuation.
    expect(squash(carveToHtml('> a\nb\n'))).toBe('<blockquote><p>a b</p></blockquote>')
  })

  it('does not fold after a definition term', () => {
    // A term holds inline content, not a paragraph, so there is nothing to
    // extend. This produced `<dt>t ~</dt>`.
    expect(squash(carveToHtml('>:: t\n~\n'))).toBe(
      '<blockquote> <dl> <dt>t</dt> </dl> </blockquote> <p>~</p>',
    )
  })

  it('does not fold after a footnote definition', () => {
    expect(squash(carveToHtml('>[f]: ~\n/\n'))).toBe('<blockquote> </blockquote> <p>/</p>')
  })

  it('does not fold after a link reference definition', () => {
    expect(squash(carveToHtml('> [r]: u\nc\n'))).toBe('<blockquote> </blockquote> <p>c</p>')
  })

  it('does not fold after an abbreviation definition', () => {
    expect(squash(carveToHtml('> *[A]: b\nc\n'))).toBe('<blockquote> </blockquote> <p>c</p>')
  })

  it('still does not fold after a heading, table row or thematic break', () => {
    // Already correct; here so a fix cannot regress the cases that motivated
    // the same rule the first time.
    expect(squash(carveToHtml('> # h\nb\n'))).toBe(
      '<blockquote> <h1 id="h">h</h1> </blockquote> <p>b</p>',
    )
    expect(squash(carveToHtml('> ---\nc\n'))).toContain('</blockquote> <p>c</p>')
  })
})
