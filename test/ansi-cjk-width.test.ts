import { describe, it, expect } from 'vitest'
import { carveToAnsi } from '../src/index.js'

const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '')

describe('ANSI table East-Asian wide-char width', () => {
  it('allots two columns per CJK char so the box borders align', () => {
    const out = strip(carveToAnsi('| 日本 | b |\n|---|---|\n| 語 | y |\n'))
    // The `日本` cell occupies 4 columns -> a 6-wide bordered column.
    expect(out).toContain('┌──────┬───┐')
    expect(out).toContain('│ 日本 │ b │')
    // The single-CJK `語` cell is padded to the same width.
    expect(out).toContain('│ 語   │ y │')
  })
})
