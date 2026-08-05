import { describe, it, expect } from 'vitest'
import { parse, carveToHtml, carveToCarve } from '../src/index.js'

/**
 * A reference image with a caption is a FIGURE in the published tree.
 *
 * `parse()` returned a paragraph holding `[Image, SoftBreak, Text("^ cap")]`
 * while `carveToHtml` on the same input produced a `<figure>` - so this engine's
 * AST disagreed with this engine's own output, and an AST consumer saw the caption
 * marker as content (carve-js#680).
 *
 * The inconsistency was specific to the REFERENCE form, and specifically odd
 * because `parse()` had ALREADY resolved the reference: the image carried `src`,
 * so the tree held a resolved image whose caption was still unparsed text. Only
 * the promotion was deferred, to `resolve()`, which `carveToHtml` calls and
 * `parse()` does not.
 *
 * `figuresOnly` deliberately. The sole-image -> block-image promotion stays out of
 * `parse()`: a one-image PARAGRAPH can carry a leading block-attribute line
 * (`{#id}`) that a bare block image would have to move inline, and the formatter
 * depends on that. So `![a][ok]` with no caption is still a paragraph here where
 * carve-rs gives an image - reported separately rather than traded for a formatter
 * change.
 *
 * THE SPAN HAD TO MOVE WITH THE VALUE. Stripping `^ ` from the caption's leading
 * text while keeping the paragraph's span left a node whose own span did not slice
 * back to it - `value: "cap"` over a range covering `"^ cap"`. That is exactly
 * carve-rs#620, which this fix would otherwise have imported into this engine
 * along with the figure. carve-php already advances it.
 */

const REF_CAPTION = '![a][ok]\n^ cap\n\n[ok]: /p.png\n'
const DIRECT_CAPTION = '![a](/p.png)\n^ cap\n'

describe('a reference image with a caption', () => {
  it('is a figure in the parsed tree', () => {
    const doc = parse(REF_CAPTION)
    expect(doc.children.map((c) => c.type)).toEqual(['figure'])
  })

  it('carries the caption with the marker stripped', () => {
    const fig = parse(REF_CAPTION).children[0] as never as { caption: { value: string }[] }
    expect(fig.caption.map((c) => c.value)).toEqual(['cap'])
  })

  it('gives the caption a span that slices back to its own text', () => {
    // The half that would have been a new defect rather than a fix.
    const node = parse(REF_CAPTION).children[0] as never as {
      caption: { value: string; pos: { startOffset: number; endOffset: number; startColumn: number } }[]
    }
    const c = node.caption[0]!
    expect(REF_CAPTION.slice(c.pos.startOffset, c.pos.endOffset)).toBe(c.value)
    // `^ ` is two columns, so the text starts at column 3, not 1.
    expect(c.pos.startColumn).toBe(3)
  })

  it('agrees with the DIRECT form, which was already a figure', () => {
    const direct = parse(DIRECT_CAPTION).children[0] as never as {
      type: string
      caption: { value: string; pos: { startOffset: number; endOffset: number } }[]
    }
    expect(direct.type).toBe('figure')
    const c = direct.caption[0]!
    expect(DIRECT_CAPTION.slice(c.pos.startOffset, c.pos.endOffset)).toBe(c.value)
  })

  it('leaves HTML and fmt output byte-identical', () => {
    // Both already ran this pass themselves, so the fix must be invisible here.
    // If either changed, the promotion moved rather than being added.
    expect(carveToHtml(REF_CAPTION)).toContain('<figcaption>cap</figcaption>')
    expect(carveToCarve(REF_CAPTION)).toContain('^ cap')
    expect(carveToCarve(REF_CAPTION)).not.toContain('\\^')
  })

  it('leaves an UNRESOLVED reference image a paragraph', () => {
    // No definition, so no image to hang a caption on: the line stays literal in
    // every implementation, and the caption marker stays in the text.
    const doc = parse('![a][none]\n^ cap\n')
    expect(doc.children.map((c) => c.type)).toEqual(['paragraph'])
  })

  it('leaves a bare reference image a paragraph, as before', () => {
    // The row deliberately NOT changed here (see the note above). Pinned so the
    // choice is visible: if someone promotes it, this test says what to check.
    const doc = parse('![a][ok]\n\n[ok]: /p.png\n')
    expect(doc.children.map((c) => c.type)).toEqual(['paragraph'])
  })

  it('does not promote an image indented above the content column', () => {
    // The strict column-0 rule the promotion is gated on.
    const doc = parse('- text\n\n    ![a][ok]\n    ^ cap\n\n[ok]: /p.png\n')
    const json = JSON.stringify(doc)
    expect(json).not.toContain('"figure"')
  })
})
