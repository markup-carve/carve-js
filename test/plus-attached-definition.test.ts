import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * A lone `+` attaches the next visible flush-left block to the item above it
 * (PART 9 §17 L3/L4). A definition is invisible, and a following blank
 * refuses the marker under the carve#4449 ruling.
 *
 * The prepass's column stack still held the ITEM's content column, so a
 * definition after the marker looked below-column and was skipped - while
 * the item collector took the line out of the document. It rendered nowhere and
 * defined nothing, the combination carve#624 named (carve#665). carve-php and
 * carve-rs both collect it.
 */
describe('a definition attached by a + continuation marker', () => {
  it('registers', () => {
    expect(carveToHtml('- a\n+\n[r]: /u\n\nsee [t][r]\n')).toBe(
      '<ul>\n  <li>a\n+</li>\n</ul>\n<p>see <a href="/u">t</a></p>',
    )
  })

  it('does not leave the line in the item', () => {
    expect(carveToHtml('- a\n+\n[r]: /u\n\nsee [t][r]\n')).not.toContain('[r]:')
  })

  it('keeps the marker as a letter before a blank following the definition', () => {
    const withPlus = carveToHtml('- a\n+\n[r]: /u\n\nsee [t][r]\n')
    const withBlank = carveToHtml('- a\n\n[r]: /u\n\nsee [t][r]\n')

    expect(withPlus).toBe('<ul>\n  <li>a\n+</li>\n</ul>\n<p>see <a href="/u">t</a></p>')
    expect(withBlank).toBe('<ul>\n  <li>a</li>\n</ul>\n<p>see <a href="/u">t</a></p>')
  })

  it('a blank line closes the attachment', () => {
    // After the blank, column 0 is top level again - which it already was for
    // this shape, so the control is that nothing changed.
    expect(carveToHtml('- a\n+\ntext\n\n[r]: /u\n\nsee [t][r]\n')).toContain('href="/u"')
  })

  it('leaves a definition at the item content column alone', () => {
    expect(carveToHtml('- a\n  [r]: /u\n\nsee [t][r]\n')).toContain('href="/u"')
  })
})
