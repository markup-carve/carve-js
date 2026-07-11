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
})
