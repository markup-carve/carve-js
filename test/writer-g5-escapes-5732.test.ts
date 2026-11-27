import { describe, expect, it } from 'vitest'
import { format } from '../src/index.ts'

// Ruled on markup-carve/carve-php#6126: carve-php and carve-rs write these bytes.
describe('carve-js#5732: escapes the bare text does not need', () => {
  // C2-I-043, C2-W-125 case one: a brace that ends link text stands before `]`, not before the strong's closer.
  it.each([
    '*[{]()*\n',
    '/[{]()/\n',
    '*a [b{](u)*\n',
    '*[^a{]*\n',
  ])('keeps the brace of %j bare', (input) => {
    expect(format(input)).toBe(input)
    expect(format(input, { normalize: true })).toBe(input)
  })

  it('still escapes a brace before the closer of the strong itself', () => {
    expect(format('x *\\{*\n')).toBe('x *\\{*\n')
  })

  // C2-W-088, C2-W-010: past the C2-I-118 depth cap the rounds keep the link brackets bare; the verbatim reference
  // spelling after them changes no escape outside the reference.
  it('writes a depth-cap paragraph with a sidecar as without one', () => {
    const input = `${'['.repeat(198)}[x][][[]()[[]()[\n`
    expect(format(input)).toBe(input)
    expect(format(input, { normalize: true })).toBe(input)
  })
})
