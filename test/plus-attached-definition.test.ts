import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * A lone `+` attaches the following flush-left block to the item above it
 * (PART 9 §17 L3/L4), so that block is item content written at column 0.
 *
 * The prepass's column stack still held the ITEM's content column, so a
 * definition in the attached block looked below-column and was skipped - while
 * the item collector took the line out of the document. It rendered nowhere and
 * defined nothing, the combination carve#624 named (carve#665). carve-php and
 * carve-rs both collect it.
 */
describe('a definition attached by a + continuation marker', () => {
  it('registers', () => {
    expect(carveToHtml("- a\n\nsee [t][r]\n\n[r]: /u\n")).toBe(
      '<ul>\n  <li>a</li>\n</ul>\n<p>see <a href="/u">t</a></p>',
    )
  })

  it('does not leave the line in the item', () => {
    expect(carveToHtml("- a\n\nsee [t][r]\n\n[r]: /u\n")).not.toContain('[r]:')
  })

  it('matches the same document with a blank instead of the marker', () => {
    const withPlus = carveToHtml("- a\n\nsee [t][r]\n\n[r]: /u\n")
    const withBlank = carveToHtml("- a\n\nsee [t][r]\n\n[r]: /u\n")

    expect(withPlus).toBe(withBlank)
  })

  it('a blank line closes the attachment', () => {
    // After the blank, column 0 is top level again - which it already was for
    // this shape, so the control is that nothing changed.
    expect(carveToHtml("- a\n+\ntext\n\nsee [t][r]\n\n[r]: /u\n")).toContain('href="/u"')
  })

  it('leaves a definition at the item content column alone', () => {
    expect(carveToHtml("- a\n\nsee [t][r]\n\n[r]: /u\n")).toContain('href="/u"')
  })
})
