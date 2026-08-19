import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

/**
 * The writer stops emitting a `+` where a block-attributes line already
 * interrupts (markup-carve/carve#1275).
 *
 * `a-paragraph-attached-by-a-continuation-marker.test.ts` states the rule this
 * narrows: a paragraph indented under an item is a LAZY CONTINUATION of the
 * paragraph above it, so the item comes back holding one block where the author
 * wrote two, and the marker is what keeps them apart.
 *
 * The premise stops holding the moment the block carries attributes the writer
 * has to put on a line of their own ahead of it. `block_attributes` is one of
 * PART 9 §10's INVISIBLE CONSTRUCTS: it INTERRUPTS an open paragraph. So the
 * fold cannot happen, the item comes back holding two blocks either way, and
 * the marker adds a construct the document did not have.
 *
 * This is not a choice between two spellings. Writing the marker made this
 * engine and carve-php disagree with carve-rs on
 * `322-an-attribute-block-reaches-the-nested-list-it-precedes-3`, whose corpus
 * source is the indented form - the one cross-engine difference left in the
 * spec's `carve` target after everything else landed. It is also the form the
 * other fourteen documents of that family are already written in, by all three
 * engines.
 *
 * The attributed IMAGE is the case that keeps the marker and belongs here as
 * the control: its attributes are written INLINE (`![a](i.png){.c}`), no
 * attribute line is produced, nothing interrupts, and it still folds.
 */
describe('an attribute line is the interruption the marker was for', () => {
  const roundTrips = (src: string): boolean => carveToHtml(carveToCarve(src)) === carveToHtml(src)

  const attributedParagraph = '- a\n  {.x}\n  para\n'

  it('writes an attributed paragraph indented, with no marker', () => {
    expect(carveToCarve(attributedParagraph)).toBe(attributedParagraph)
  })

  it('still round-trips, which is what the marker was protecting', () => {
    expect(roundTrips(attributedParagraph)).toBe(true)
  })

  it('is idempotent', () => {
    const once = carveToCarve(attributedParagraph)

    expect(carveToCarve(once)).toBe(once)
  })

  it('reads the marker form back to the same document it writes without one', () => {
    // Both spellings are legal source. The writer picks one; the parser has to
    // keep answering the same for the other, or dropping the marker would be a
    // silent change of document rather than of spelling.
    expect(carveToHtml('- a\n+\n{.x}\npara\n')).toBe(carveToHtml(attributedParagraph))
  })

  it('does the same for an attributed figure', () => {
    // The other kind whose canonical source is a bare inline run and whose
    // attributes go on a line of their own.
    const src = '- x\n  {.c}\n  ![a](i.png)\n  ^ cap\n'

    expect(carveToCarve(src)).toBe(src)
    expect(roundTrips(src)).toBe(true)
  })

  it('CONTROL: keeps the marker where no attribute line is written', () => {
    // The rule this narrows, unchanged. A bare paragraph folds, so the marker
    // stays.
    expect(carveToCarve('- a\n+\npara\n')).toContain('\n+\n')
    expect(roundTrips('- a\n+\npara\n')).toBe(true)
  })

  it('CONTROL: keeps the marker for an attributed image, whose attributes are inline', () => {
    const src = '- x\n+\n![a](i.png){.c}\n'

    expect(carveToCarve(src)).toContain('\n+\n')
    expect(roundTrips(src)).toBe(true)
  })

  it('CONTROL: a paragraph whose own text is braced is escaped, not mistaken for attributes', () => {
    // The writer escapes a leading brace precisely so it cannot come back as
    // attributes - which is why reading the written first line is enough to
    // tell an attribute line from paragraph text.
    const src = '- x\n+\n\\{.c\\}\n'

    expect(carveToCarve(src)).toContain('\n+\n')
    expect(roundTrips(src)).toBe(true)
  })
})
