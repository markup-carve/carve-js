import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

/*
 * PART 11 §7e: a block that opens a tight item goes on the marker line and the
 * continuation marker on the line below it. Both spellings re-parse to the same
 * document, so the invariants in §1 cannot tell them apart - only the bytes can.
 *
 * Section 464 pins these documents upstream; the pin in this repo does not carry
 * it yet.
 */
describe('a block that opens a tight item', () => {
  it('is written on the marker line', () => {
    expect(carveToCarve('- +\n> p\n+\n> z\n')).toBe('- > p\n+\n> z\n')
  })

  it('is a fixed point in the canonical form', () => {
    expect(carveToCarve('- > p\n+\n> z\n')).toBe('- > p\n+\n> z\n')
  })

  it('keeps the document it was given', () => {
    const src = '- +\n> p\n+\n> z\n'

    expect(carveToHtml(carveToCarve(src))).toBe(carveToHtml(src))
  })

  it('takes the marker line inside a quote too', () => {
    const canonical = '> - | a |\n>   | b |\n> +\n> | c |\n> | d |\n'

    expect(carveToCarve(canonical)).toBe(canonical)
  })

  it('still writes the marker above a block that does not open the item', () => {
    expect(carveToCarve('- a\n+\n> p\n+\n> z\n')).toBe('- a\n+\n> p\n+\n> z\n')
  })

  it('leaks no marker-column sentinel', () => {
    expect(carveToCarve('- +\n> p\n+\n> z\n')).not.toMatch(/[-]/)
  })
})
