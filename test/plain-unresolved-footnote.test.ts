import { describe, expect, it } from 'vitest'
import { carveToPlainText, carveToHtml } from '../src/index.js'

/**
 * A footnote reference with no matching definition did not form a footnote, so
 * every target has to reproduce it as source text. The HTML target already does,
 * via the `number` field that numbering assigns - the plain target does no
 * numbering, so it had nothing to check and dropped the caret, inventing a
 * reference the document does not have (carve#352).
 *
 * carve-php was the only engine getting this right; carve-js and carve-rs both
 * emitted `[a]`.
 */
describe('an unresolved footnote reference stays literal in plain text', () => {
  it('keeps the caret when there is no definition', () => {
    expect(carveToPlainText('Use [^a].\n')).toBe('Use [^a].\n')
  })

  it('agrees with what the HTML target does with the same input', () => {
    // HTML renders the unresolved reference as literal source; plain must not
    // disagree about whether the construct exists.
    expect(carveToHtml('Use [^a].\n')).toContain('[^a]')
    expect(carveToPlainText('Use [^a].\n')).toContain('[^a]')
  })

  it('still renders a resolved reference as a marker', () => {
    expect(carveToPlainText('Use [^a].\n\n[^a]: A real note.\n')).toBe(
      'Use [a].\n\n[a]: A real note.\n',
    )
  })

  it('is not confused by a definition for a different label', () => {
    expect(carveToPlainText('Use [^a].\n\n[^b]: Other.\n')).toBe('Use [^a].\n\n[b]: Other.\n')
  })

  it('leaves an inline note alone', () => {
    expect(carveToPlainText('Use ^[a note].\n')).toBe('Use (a note).\n')
  })
})
