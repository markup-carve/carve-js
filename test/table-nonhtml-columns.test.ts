import { describe, it, expect } from 'vitest'
import { carveToMarkdown, carveToPlainText, carveToAnsi } from '../src/index.js'

/**
 * Non-HTML table renderers must use the table's true column count (max cells
 * across rows) so a header-rowspan table keeps every column, matching the HTML
 * renderer and carve-php / carve-rs (round-12 conformance).
 */
const stripSgr = (s: string) => s.replace(/\[[0-9;]*m/g, '')

describe('non-HTML table column count (header-rowspan)', () => {
  const src = '|=A|\n|^|x|\n'

  it('markdown keeps both columns', () => {
    expect(carveToMarkdown(src)).toBe('| A |\n| --- | --- |\n|  | x |\n')
  })

  it('plain text keeps both columns', () => {
    expect(carveToPlainText(src)).toBe('A | \n | x\n')
  })

  it('ansi keeps both columns aligned with the border', () => {
    const out = stripSgr(carveToAnsi(src))
    expect(out).toContain('│ A │   │')
    expect(out).toContain('│   │ x │')
  })
})
