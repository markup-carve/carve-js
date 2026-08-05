import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/**
 * A definition's trailing attribute block reaches a reference IMAGE, not only a
 * reference link.
 *
 * The clause is NORMATIVE and spells the case out: "AN IMAGE REFERENCE RESOLVES
 * THE SAME ENTRY - `![alt][ex]` looks the label up in the same `linkDefs` table
 * and takes the same three fields, so `[ex]: /i.png {.wide}` gives
 * `<img src="/i.png" alt="alt" class="wide">`."
 *
 * This engine took `href` and `title` from that entry and stopped. Two of three
 * fields transferring is not a rule, it is where the implementation stopped - and
 * the clause says so, naming this engine and carve-rs. The link branch a few lines
 * above already did the merge; the image branch was simply missing the line
 * (carve#697).
 *
 * THE MERGE IS §15 A3's, the same one the link branch uses: the definition's list
 * first, the use site's second - so a repeated key takes the LAST value and
 * classes ACCUMULATE in source order. Asserting only "class is present" would pass
 * for a merge that replaced instead of accumulating, so the order is asserted
 * exactly.
 *
 * Measured against the executable spec and carve-php, which both already did this;
 * carve-rs still drops them (markup-carve/carve-rs).
 */

describe("a definition's attributes on a reference image", () => {
  it('reach the image', () => {
    expect(carveToHtml('![a][ex]\n\n[ex]: /i.png {.wide}\n').trim()).toBe(
      '<img src="/i.png" alt="a" class="wide">',
    )
  })

  it('merge with the use site per §15 A3, definition first', () => {
    // Classes accumulate in source order; the repeated id takes the use site's.
    expect(carveToHtml('![a][ex]{.internal #b}\n\n[ex]: /i.png {.external #a}\n').trim()).toBe(
      '<img src="/i.png" alt="a" class="external internal" id="b">',
    )
  })

  it('reach a COLLAPSED image reference too', () => {
    expect(carveToHtml('![ex][]\n\n[ex]: /i.png {.wide}\n').trim()).toBe(
      '<img src="/i.png" alt="ex" class="wide">',
    )
  })

  it('arrive alongside the title, not instead of it', () => {
    // `title` already crossed before this fix; pinned so the new line cannot be
    // written in a way that displaces it.
    expect(carveToHtml('![a][ex]\n\n[ex]: /i.png "T" {.wide}\n').trim()).toBe(
      '<img src="/i.png" alt="a" title="T" class="wide">',
    )
  })

  it('leave a reference LINK working as before', () => {
    // The branch that was already right, and the one this fix was copied from.
    expect(carveToHtml('[t][ex]{.internal #b}\n\n[ex]: /u {.external #a}\n').trim()).toBe(
      '<p><a href="/u" class="external internal" id="b">t</a></p>',
    )
  })

  it('do not appear on an UNRESOLVED reference image', () => {
    // No definition, so nothing to merge, and the literal source survives whole.
    expect(carveToHtml('![a][none]{.x}\n').trim()).toBe('<p>![a][none]{.x}</p>')
  })

  it('leave a DIRECT image alone', () => {
    // The boundary: a direct image never consults the table.
    expect(carveToHtml('![a](/d.png){.x}\n').trim()).toBe('<img src="/d.png" alt="a" class="x">')
  })

  it('reach an INLINE reference image inside a paragraph', () => {
    // The resolution pass walks children; an image mid-paragraph goes through the
    // same branch and must not be missed.
    const out = carveToHtml('see ![a][ex] here\n\n[ex]: /i.png {.wide}\n')
    expect(out).toContain('class="wide"')
  })
})
