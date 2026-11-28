import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { format, parse, treesEqual } from '../src/index.ts'

describe('C2-W-088: a round reports the constructs behind the place its comparison stopped (carve#6802)', () => {
  it('escapes every potential `*` opener of the paragraph past the inline depth cap', () => {
    const source = '[a *[a][x]*[x]: /u\n'.repeat(122)
    const written = format(source)
    expect(written.length).toBe(2620)
    expect(createHash('sha256').update(written).digest('hex').slice(0, 16)).toBe('66da9722cf00a317')
    expect(written.split('\n').slice(99, 101)).toEqual(['[a \\*\\[a][x]\\*\\[x\\]: /u', '\\[a \\*\\[a][x]*\\[x\\]: /u'])
    expect(treesEqual(parse(written), parse(source))).toBe(true)
    expect(format(written)).toBe(written)
  })

  it('finds the openers behind a character outside the basic plane', () => {
    const source = '\u{1F600} [a *[a][x]*[x]: /u\n'.repeat(122)
    const written = format(source)
    expect(written.split('\n')[99]).toBe('\u{1F600} [a \\*\\[a][x]\\*\\[x\\]: /u')
    expect(treesEqual(parse(written), parse(source))).toBe(true)
    expect(format(written)).toBe(written)
  })
})
