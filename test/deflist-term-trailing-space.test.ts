import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * Trailing whitespace is dropped on EVERY line a term is made of - the marker
 * line and every physical line folded into it.
 *
 * Found by the differential fuzzer (carve#510), on `:: ` + a code span + a
 * trailing space: the space survived beside the `</code>`, which is where it is
 * least likely to be noticed and most likely to matter, since a code span makes
 * the surrounding whitespace look deliberate.
 *
 * The continuation half stayed broken for longer (markup-carve/carve-js#1145).
 * A folded line ends in a soft break exactly as a paragraph's does, so the run
 * before it is trailing whitespace by the same rule; carve-js kept it and both
 * other engines did not.
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

  it('drops it on a folded continuation line too', () => {
    expect(carveToHtml(':: one\ntwo \n:  d\n')).toContain('<dt>one\ntwo</dt>')
  })

  it('drops it on an INTERIOR folded line, not only the last', () => {
    expect(carveToHtml(':: one\ntwo \nthree\n:  d\n')).toContain('<dt>one\ntwo\nthree</dt>')
  })

  it('drops a continuation line trailing tab', () => {
    expect(carveToHtml(':: one\ntwo\t\n:  d\n')).toContain('<dt>one\ntwo</dt>')
  })

  it('keeps a trailing NBSP on a continuation line, dropping only the space after it', () => {
    // PART 1: whitespace is a space or a tab. Everything else is content, on a
    // folded line as much as on the marker line (carve#926).
    expect(carveToHtml(':: one\ntwo\u00a0 \n:  d\n')).toContain('<dt>one\ntwo&nbsp;</dt>')
  })

  it('reads a continuation line ending in a backslash-space as a hard break', () => {
    // The strip runs BEFORE escape resolution (carve#1027), so the `\` the run
    // leaves behind is in the last column and breaks the line. carve-js read
    // the escaped space and published a no-break space instead.
    expect(carveToHtml(':: one\ntwo\\ \n:  d\n')).toContain('<dt>one\ntwo<br>\n</dt>')
  })
})
