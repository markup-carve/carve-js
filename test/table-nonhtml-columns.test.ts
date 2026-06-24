import { describe, it, expect } from 'vitest'
import { carveToMarkdown, carveToPlainText, carveToAnsi } from '../src/index.js'

/**
 * Non-HTML table renderers use the table's true column count (max cells across
 * rows), but drop TRAILING empty cells per row so a header-rowspan header row
 * stays ragged (`A`, not `A | `) instead of emitting a phantom empty cell.
 * Matches the HTML renderer (one `<th rowspan>` cell) and carve-php / carve-rs.
 */
// eslint-disable-next-line no-control-regex
const stripSgr = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '')

describe('non-HTML table column count (header-rowspan)', () => {
  const src = '|=A|\n|^|x|\n'

  it('markdown keeps both columns (the separator is padded)', () => {
    expect(carveToMarkdown(src)).toBe('| A |\n| --- | --- |\n|  | x |\n')
  })

  it('plain text drops the trailing empty header cell', () => {
    expect(carveToPlainText(src)).toBe('A\n | x\n')
  })

  it('ansi renders a ragged header row (border stays full width)', () => {
    const out = stripSgr(carveToAnsi(src))
    expect(out).toContain('│ A │\n') // header: one cell, no phantom second cell
    expect(out).toContain('│   │ x │') // body: empty col 0 (rowspan), then x
    expect(out).toContain('┌───┬───┐') // border still spans both columns
  })

  it('a normal full-width header is unaffected', () => {
    expect(carveToPlainText('|=A|=B|\n|1|2|\n')).toBe('A | B\n1 | 2\n')
  })
})
