import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const flat = (source: string): string => carveToHtml(source).trim().replace(/>\s+</g, '><')

describe('a comment after a blank in a sub-item body (#4014)', () => {
  it.each([
    ['- a\n  - head\n\n    %% c\n- x\n'],
    ['- a\n  - head\n\n    %%%\n    c\n    %%%\n- x\n'],
    ['- a\n  - head\n    more\n\n    %% c\n- x\n'],
  ])('keeps the outer list tight: %j', (source) => {
    expect(flat(source)).toContain('<li>x</li>')
    expect(flat(source)).not.toContain('<p>')
  })

  it('reads a deeper body the same', () => {
    expect(flat('- a\n  - b\n    - c\n\n      %% k\n- x\n')).toContain('<li>x</li>')
  })

  it('still loosens the list for a comment at the item own column', () => {
    expect(flat('- a\n  - head\n\n  %% c\n- x\n')).toContain('<p>x</p>')
  })

  it('still loosens the list for a comment with no sub-item above it', () => {
    expect(flat('- a\n\n  %% c\n- x\n')).toContain('<p>x</p>')
  })
})
