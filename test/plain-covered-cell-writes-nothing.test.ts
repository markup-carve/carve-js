import { describe, expect, it } from 'vitest'
import { carveToPlainText } from '../src/index.js'

// CARVE-P11-082: a cell a span covers contributes no text and no separator.
describe('the plain-text target writes nothing for a covered cell', () => {
  it('drops a column-span cell instead of writing it empty', () => {
    const source = '|= Pos |= Betrag |\n| 1 | 1.200,00 € |\n| Summe netto | < |\n'
    expect(carveToPlainText(source)).toBe('Pos | Betrag\n1 | 1.200,00 €\nSumme netto\n')
  })

  it('keeps the cells after a span', () => {
    const source = '| a | b | c |\n| wide | < | x |\n| all | < | < |\n'
    expect(carveToPlainText(source)).toBe('a | b | c\nwide | x\nall\n')
  })

  it('starts a row a rowspan covers at its first uncovered cell', () => {
    const source = '| a | b |\n| ^ | c |\n'
    expect(carveToPlainText(source)).toBe('a | b\nc\n')
  })

  it('writes an orphan marker as an empty cell', () => {
    const source = '| < | a |\n'
    expect(carveToPlainText(source)).toBe(' | a\n')
  })
})
