/*
 * A tab after the definition-term separator is stripped, not content
 * (carve-js#722, spec markup-carve/carve#794).
 *
 * `RE_DEFLIST_TERM` was `/^::(?!:) +(?=\S)(.+)$/`. The lookahead straight after
 * ` +` required the term to begin on a non-space, so `:: <TAB>x` matched
 * nothing and fell through to a paragraph - while `::   x`, which differs only
 * in which whitespace follows the separator, was a term.
 *
 * TWO RULES MEET HERE and the fix must not blur them:
 *
 *   `:: <TAB>x`   the separator space IS present; the tab is leading whitespace
 *                 on the term and is stripped. THIS is what changed.
 *   `::<TAB>x`    no separator space at all. A tab does not satisfy the marker's
 *                 separator, so the line stays a paragraph - unchanged, and
 *                 pinned by corpus 176-a-marker-separator-is-a-space-never-a-tab.
 *
 * The second is why the leading space in the pattern stays required rather than
 * being widened to `[ \t]+`, which would have made both cases terms and broken
 * a corpus fixture.
 */

import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const flat = (html: string): string => html.replace(/\n\s*/g, ' ').trim()

describe('the definition-term separator', () => {
  it('strips a tab that follows the separator space', () => {
    expect(flat(carveToHtml(':: \tx\n'))).toBe('<dl> <dt>x</dt> </dl>')
  })

  it('still refuses a tab INSTEAD of the separator space', () => {
    // The neighbouring rule. Widening the separator to accept a tab would make
    // this a term too, and corpus 176 says it is prose.
    expect(flat(carveToHtml('::\tx\n'))).toBe('<p>::\tx</p>')
  })

  it('is unchanged for ordinary spacing', () => {
    expect(flat(carveToHtml(':: x\n'))).toBe('<dl> <dt>x</dt> </dl>')
    expect(flat(carveToHtml('::   x\n'))).toBe('<dl> <dt>x</dt> </dl>')
  })

  it('does not turn a marker with no term into one', () => {
    // `(?=\S)` still guards the capture, so a line that is only a marker and
    // whitespace is not a term with an empty name.
    expect(flat(carveToHtml(':: \n'))).not.toContain('<dt>')
    expect(flat(carveToHtml(':: \t\n'))).not.toContain('<dt>')
  })

  it('leaves a three-colon marker alone', () => {
    // `(?!:)` is untouched: `:::` opens a div, not a definition term.
    expect(flat(carveToHtml(':::  x\n'))).not.toContain('<dt>')
  })

  it('strips a tab in a term that has a description too', () => {
    // The whole construct, not just the term line in isolation.
    const html = flat(carveToHtml(':: \tterm\n:  body\n'))
    expect(html).toContain('<dt>term</dt>')
    expect(html).toContain('<dd>')
  })
})
