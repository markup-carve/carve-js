import { describe, expect, it } from 'vitest'
import { carveToAnsi, carveToHtml } from '../src/index.js'

const ESC = String.fromCharCode(27)

/**
 * A footnote reference with no matching definition did not form a footnote, so
 * every target has to reproduce it as source text. This one dropped the caret
 * AND styled the result cyan-bold, announcing a footnote the document does not
 * have (carve#352).
 *
 * Same blind spot the plain target had: the HTML renderer decides on
 * `node.number`, which numbering assigns, and neither of these targets does any
 * numbering - so the check had nothing to check.
 */
describe('an unresolved footnote reference stays literal in ANSI', () => {
  it('keeps the caret and adds no styling', () => {
    expect(carveToAnsi('Use [^a].\n')).toBe('Use [^a].\n')
  })

  it('agrees with the HTML target about the same input', () => {
    expect(carveToHtml('Use [^a].\n')).toContain('[^a]')
    expect(carveToAnsi('Use [^a].\n')).toContain('[^a]')
  })

  it('still styles a resolved reference', () => {
    const out = carveToAnsi('Use [^a].\n\n[^a]: A real note.\n')
    expect(out).toContain('[a]')
    expect(out).toContain(ESC)
  })

  it('is not confused by a definition for a different label', () => {
    const out = carveToAnsi('Use [^a].\n\n[^b]: Other.\n')
    expect(out).toContain('[^a]')
  })
})
