import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * Trailing whitespace on a block's last line is not content. Every other block
 * here drops it - a paragraph, a heading, a quoted paragraph - and the
 * definition TERM kept it, so `:: t ` published `<dt>t </dt>` where carve-rs and
 * carve-php publish `<dt>t</dt>`.
 *
 * Found by the differential fuzzer (carve#510), on `:: ` + a code span + a
 * trailing space: the space survived beside the `</code>`, which is where it is
 * least likely to be noticed and most likely to matter, since a code span makes
 * the surrounding whitespace look deliberate.
 */
describe('a definition term', () => {
  it('drops trailing spaces, like every other block', () => {
    expect(carveToHtml(':: t \n:  d\n')).toContain('<dt>t</dt>')
  })

  it('drops a trailing tab too', () => {
    expect(carveToHtml(':: t \t\n:  d\n')).toContain('<dt>t</dt>')
  })

  it('drops the space after a closing code span', () => {
    expect(carveToHtml(':: `x` \n:  d\n')).toContain('<dt><code>x</code></dt>')
  })

  it('keeps interior whitespace', () => {
    expect(carveToHtml(':: a  b\n:  d\n')).toContain('<dt>a  b</dt>')
  })

  it('leaves a term with no trailing whitespace alone', () => {
    expect(carveToHtml(':: t\n:  d\n')).toContain('<dt>t</dt>')
  })

  it('drops it on a folded continuation line as well', () => {
    // A term folds a following plain line as a soft break; the trailing space
    // then sits at the end of the SECOND line.
    expect(carveToHtml(':: one\ntwo \n:  d\n')).toContain('<dt>one\ntwo</dt>')
  })
})
