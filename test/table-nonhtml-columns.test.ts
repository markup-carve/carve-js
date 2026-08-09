import { describe, it, expect } from 'vitest'
import { carveToMarkdown, carveToPlainText, carveToAnsi } from '../src/index.js'

/**
 * Markdown and plain text preserve each AST row's cell count. ANSI is a display
 * grid instead: it pads short rows to the table width so its box is rectangular.
 */
// eslint-disable-next-line no-control-regex
const stripSgr = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '')

describe('non-HTML table column count (header-rowspan)', () => {
  const src = '|=A|\n|^|x|\n'

  it('markdown gives the delimiter the header row cell count', () => {
    expect(carveToMarkdown(src)).toBe('| A |\n| --- |\n|  | x |\n')
  })

  it('plain text drops the trailing empty header cell', () => {
    expect(carveToPlainText(src)).toBe('A\n | x\n')
  })

  it('ansi pads a ragged header row to the full-width border', () => {
    const out = stripSgr(carveToAnsi(src))
    expect(out).toContain('│ A │   │\n') // synthetic display cell closes the row
    expect(out).toContain('│   │ x │') // body: empty col 0 (rowspan), then x
    expect(out).toContain('┌───┬───┐') // border still spans both columns
  })

  it('a normal full-width header is unaffected', () => {
    expect(carveToPlainText('|=A|=B|\n|1|2|\n')).toBe('A | B\n1 | 2\n')
  })
})
