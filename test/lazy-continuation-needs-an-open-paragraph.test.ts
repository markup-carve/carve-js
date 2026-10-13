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
 * Invisible definitions leave no leaf that accepts lazy text. A term does
 * accept it, ruled on markup-carve/carve-js#2860 under PART 0.
 */
const squash = (html: string) => html.replace(/\s+/g, ' ').trim()

describe('lazy continuation into a block quote', () => {
  it('folds into an open paragraph', () => {
    // The control, pinned by corpus 82-blockquote-lazy-continuation.
    expect(squash(carveToHtml('> a\nb\n'))).toBe('<blockquote><p>a b</p></blockquote>')
  })

  it('folds after a definition term', () => {
    expect(squash(carveToHtml('> :: t\n~\n'))).toBe(
      '<blockquote> <dl> <dt>t ~</dt> </dl> </blockquote>',
    )
  })

  it('does not fold after a footnote definition', () => {
    expect(squash(carveToHtml('> [f]: ~\n/\n'))).toBe('<blockquote> </blockquote> <p>/</p>')
  })

  it('does not fold after a link reference definition', () => {
    expect(squash(carveToHtml('> [r]: u\nc\n'))).toBe('<blockquote> </blockquote> <p>c</p>')
  })

  it('folds after an abbreviation-definition-shaped line, which is text here', () => {
    // Inside a container the definition form is not recognized (PART 12 §7),
    // so it IS an open paragraph and a lazy line continues it - unlike the
    // link and footnote definitions above, which stay definitions in a quote.
    expect(squash(carveToHtml('> *[A]: b\nc\n'))).toBe('<blockquote><p>*[A]: b c</p></blockquote>')
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
