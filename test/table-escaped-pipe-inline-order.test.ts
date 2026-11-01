import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const cell = (content: string): string => `<table>\n  <tbody>\n    <tr><td>${content}</td></tr>\n  </tbody>\n</table>`

describe('a table cell unescapes its pipe before inline parsing (carve#4718)', () => {
  it('renders an unresolved link reference from the cell value', () => {
    expect(carveToHtml('| [a\\|b][m] |\n')).toBe(cell('[a|b][m]'))
  })

  it('renders an unresolved image reference from the cell value', () => {
    expect(carveToHtml('| ![a\\|b][m] |\n')).toBe(cell('![a|b][m]'))
  })

  it('resolves a label containing a pipe', () => {
    expect(carveToHtml('[r|s]: /u\n\n| [x][r\\|s] |\n')).toBe(cell('<a href="/u">x</a>'))
  })

  it('keeps an escaped pipe in an inline destination', () => {
    expect(carveToHtml('| [x](a\\|b) |\n')).toBe(cell('<a href="a|b">x</a>'))
  })
})
