import { describe, it, expect } from 'vitest'
import { carveToPlainText, carveToAnsi } from '../src/index.js'

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '')

describe('non-HTML tables keep a genuine trailing empty cell', () => {
  it('plain: a genuine trailing empty cell is kept', () => {
    expect(carveToPlainText('| x || \n|---|---|\n')).toBe('x |\n')
  })
  it('plain: a rowspan short row stays ragged (synthetic padding dropped)', () => {
    const out = carveToPlainText('| a | b |\n|---|---|\n| ^ | y |\n| z |\n')
    expect(out).toContain('z\n')
    expect(out).not.toContain('z |')
  })
  it('ansi: a genuine trailing empty cell keeps the box well-formed', () => {
    expect(strip(carveToAnsi('| x || \n|---|---|\n'))).toContain('│ x │  │')
  })
  it('ansi: a short row gets a synthetic trailing display cell', () => {
    expect(strip(carveToAnsi('| h |\n|---|\n| |x |\n'))).toContain('│ h │   │')
  })
  // The mirror witness. The header case alone would pass a renderer that only
  // padded the row it promotes; the ruling on markup-carve/carve#1044 is about
  // any short row, and the short-BODY case is the one where narrowing the box
  // to the widest row would have been a no-op.
  it('ansi: a short BODY row is padded the same way', () => {
    expect(strip(carveToAnsi('| |x |\n|---|\n| y |\n'))).toContain('│ y │   │')
  })
})
