/*
 * A zero-width character is an ordinary destination character (carve-js#750,
 * spec markup-carve/carve#806).
 *
 * The grammar says which test to use, in as many words
 * (`resources/grammar.ebnf:1227-1229`):
 *
 *   ZERO-WIDTH characters (U+200B, U+FEFF) are NOT whitespace and ARE ordinary
 *   destination characters. The test is the Unicode White_Space property, not
 *   "is invisible".
 *
 * The destination scan used `/\s/`, and JavaScript's `\s` is White_Space PLUS
 * U+FEFF - a legacy addition in the language, not a Unicode property. So a
 * byte-order mark ended the destination and the whole link fell back to literal
 * text, while U+200B, equally invisible and equally not White_Space, was
 * accepted. One character singled out by an accident of the host language.
 *
 * carve-rs and carve-php both built the link.
 */

import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const isLink = (source: string): boolean => carveToHtml(source).includes('<a href')

describe('a zero-width character in a link destination', () => {
  it('does not end the destination at its start', () => {
    expect(isLink('[x](﻿https://e.com/)\n')).toBe(true)
  })

  it('does not end the destination in the middle', () => {
    expect(isLink('[x](https://e﻿.com/)\n')).toBe(true)
  })

  it('does not end the destination at its end', () => {
    expect(isLink('[x](https://e.com/﻿)\n')).toBe(true)
  })

  it('behaves the same for U+200B, which always worked', () => {
    // The control: this one was already accepted, and the fix must not have
    // reached it by widening something.
    expect(isLink('[x](​https://e.com/)\n')).toBe(true)
  })

  it('applies in a reference definition too', () => {
    // The grammar says the same rule governs a definition, "because the
    // definition is built from this same `link_destination`". In THIS engine it
    // already held before the fix - the definition path does not go through the
    // scanner that had the `\s` test - so this is a guard rather than a witness:
    // it fails if the two paths ever diverge on the rule they share.
    expect(isLink('[r]: ﻿https://e.com/\n\nsee [t][r]\n')).toBe(true)
  })
})

describe('real whitespace still ends a destination', () => {
  it('a space does', () => {
    expect(isLink('[x]( https://e.com/)\n')).toBe(false)
  })

  it('a tab does', () => {
    expect(isLink('[x](\thttps://e.com/)\n')).toBe(false)
  })

  it('a no-break space does', () => {
    // U+00A0 IS White_Space, and invisible - the pair that shows the test is
    // the property and not visibility.
    expect(isLink('[x]( https://e.com/)\n')).toBe(false)
  })
})
