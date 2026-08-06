import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

/**
 * An abbreviation expansion keeps a leading zero-width character (carve#844).
 *
 * PART 9 already says which test decides: "ZERO-WIDTH characters (U+200B,
 * U+FEFF) are NOT whitespace and ARE ordinary destination characters. The test
 * is the Unicode White_Space property, not 'is invisible'."
 *
 * `RE_ABBR_DEF` skipped the run after the separator with `\s*`, and
 * JavaScript's `\s` is White_Space PLUS U+FEFF - the legacy addition the same
 * clause names. So a BOM at the start of an expansion was eaten here and kept
 * by carve-rs and carve-php, which is the identical defect markup-carve/carve#806
 * fixed one production over.
 */
describe('an abbreviation expansion', () => {
  const BOM = '\uFEFF'
  const ZWSP = '\u200B'

  it('keeps a leading byte-order mark', () => {
    const html = carveToHtml(`*[HTML]: ${BOM}Hyper\n\nHTML\n`)

    expect(html).toContain(`title="${BOM}Hyper"`)
  })

  it('keeps a leading zero-width space, which never went through `\\s`', () => {
    // The control on the CLASS rather than the character: U+200B was already
    // kept, so a fix that special-cased the BOM alone would look the same.
    const html = carveToHtml(`*[HTML]: ${ZWSP}Hyper\n\nHTML\n`)

    expect(html).toContain(`title="${ZWSP}Hyper"`)
  })

  it('still skips real whitespace after the separator', () => {
    // The boundary. Keeping everything would satisfy the assertions above and
    // put the author's alignment spaces into the title.
    expect(carveToHtml('*[HTML]:   Hyper\n\nHTML\n')).toContain('title="Hyper"')
  })

  it('still skips a whitespace character that `\\s` does not hold', () => {
    // U+0085 IS White_Space and is NOT in JavaScript's `\s`, so it is the
    // other direction of the same swap.
    expect(carveToHtml('*[HTML]: \u0085Hyper\n\nHTML\n')).toContain('title="Hyper"')
  })
})
