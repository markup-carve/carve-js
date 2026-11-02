import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const flat = (source: string): string => carveToHtml(source).trim().replace(/>\s+</g, '><')

// carve#4903 ruling: a blank before only invisible lines loosens the outer list at every depth (§17 L1c, L1b).
describe('a comment after a blank in a sub-item body (#4014, superseded by markup-carve/carve#4903)', () => {
  it.each([
    ['- a\n  - head\n\n    %% c\n- x\n'],
    ['- a\n  - head\n\n    %%%\n    c\n    %%%\n- x\n'],
    ['- a\n  - head\n    more\n\n    %% c\n- x\n'],
  ])('loosens the outer list: %j', (source) => {
    expect(flat(source)).toContain('<li><p>x</p></li>')
  })

  it('reads a deeper body the same', () => {
    expect(flat('- a\n  - b\n    - c\n\n      %% k\n- x\n')).toContain('<li><p>x</p></li>')
  })

  it('still loosens the list for a comment at the item own column', () => {
    expect(flat('- a\n  - head\n\n  %% c\n- x\n')).toContain('<p>x</p>')
  })

  it('still loosens the list for a comment with no sub-item above it', () => {
    expect(flat('- a\n\n  %% c\n- x\n')).toContain('<p>x</p>')
  })
})
