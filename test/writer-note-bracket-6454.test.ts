import { describe, expect, it } from 'vitest'
import { format, parse, treesEqual } from '../src/index.ts'

describe('C2-W-125 case five: a bare bracket in the content of a note that holds a strong or a superscript (carve#6454)', () => {
  it.each([
    // The `[` of the strong pairs with the closer of the note, so the note reads on into the text behind it.
    ['^[*\\[*]]]\n', '^[*\\[*]]]\n'],
    ['^[*\\[*]]\n', '^[*\\[*]]\n'],
    // The first `]` of the superscript closes the `[` of the note; the two behind it would end the note early.
    ['^[[{^]\\]\\]^}]\n', '^[[{^]\\]\\]^}]\n'],
    // A bracket pair of the content stays bare; the strong takes its braces, as it ends in a space.
    ['x ^[{*\\[\\[\\] *}]\n', 'x ^[{*\\[[] *}]\n'],
    ['^[*\\]\\[\\]\\[*]a]\n', '^[*\\]\\[\\]\\[*]a\\]\n'],
    // The strong that did not form behind the text `*a` takes its braces, not the emphasis around it.
    ['x ^[/*a{*a\\[a*}/]\n', 'x ^[/*a{*a\\[a*}/]\n'],
    // A lone closer repair gives no kind, so the text `]` behind the note stays bare.
    ['x ^[a\\]/\\]\\]/]]a]\n', 'x ^[a\\]/\\]\\]/]]a]\n'],
  ])('writes %j as %j', (source, expected) => {
    const written = format(source)
    expect(written).toBe(expected)
    expect(treesEqual(parse(written), parse(source))).toBe(true)
    expect(format(written)).toBe(written)
  })
})
