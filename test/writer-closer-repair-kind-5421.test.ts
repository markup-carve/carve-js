import { describe, expect, it } from 'vitest'
import { format, parse, treesEqual } from '../src/index.ts'

describe('C2-W-088, C2-W-125: a closer repair gives no kind in the group rounds (carve-js#5421)', () => {
  it('escapes only the closer that ended the innermost superscript early', () => {
    const source = '- \\{^{^^{^^}^^}^}\n'
    const written = format(source)
    expect(written).toBe('- \\{^{^^\\{^\\^}^^}^}\n')
    expect(treesEqual(parse(written), parse(source))).toBe(true)
    expect(format(written)).toBe(written)
  })

  it('gives the closer repairs their kind again where the rounds without it lose a node (C2-W-005)', () => {
    const source = '{^{^^}{,^{^[,}^}{^]\\{}[^}^}\n'
    const written = format(source)
    expect(treesEqual(parse(written), parse(source))).toBe(true)
    expect(format(written)).toBe(written)
  })
})
