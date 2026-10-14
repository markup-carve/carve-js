import { describe, expect, it } from 'vitest'
import { lintCarve } from '../src/lint.js'

const findings = (source: string) => lintCarve(source).filter((warning) => warning.rule === 'table-span-marker-blocked')

const blocked = [
  { source: '| ^ | b |\n', line: 1, column: 3, reason: 'There is no cell above it to extend.' },
  { source: '| a | b |\n| < | c |\n', line: 2, column: 3, reason: 'There is no cell to its left to widen.' },
  { source: '| a | < |\n| ^ | b |\n', line: 2, column: 3, reason: 'Extending the cell above would cover another cell.' },
  { source: '| a | b | c |\n| ^ | < | d |\n', line: 2, column: 7, reason: 'The cell to its left starts in an earlier row, so widening it would cover cells already placed.' },
  { source: '| a | b |\n| < | c |\n+ x | y |\n', line: 2, column: 3, reason: 'There is no cell to its left to widen.' },
  { source: '- item\n\n  | ^ | b |\n', line: 3, column: 5, reason: 'There is no cell above it to extend.' },
]

describe('table-span-marker-blocked', () => {
  for (const { source, line, column, reason } of blocked) {
    it(`reports the blocked marker in ${JSON.stringify(source)}`, () => {
      const warnings = findings(source)
      expect(warnings).toHaveLength(1)
      const [warning] = warnings
      const marker = source[warning!.start]
      expect(marker).toMatch(/[<^]/)
      const start = source.split('\n').slice(0, line - 1).reduce((length, text) => length + text.length + 1, 0) + column - 1
      expect(warning).toMatchObject({ line, column, start, end: start + 1 })
      expect(warning!.message).toBe(`The "${marker}" span marker cannot extend a cell. ${reason} It renders as a cell of its own; escape it as "\\${marker}" to keep the character as text, or remove it.`)
    })
  }

  it.each([
    '| a | < |\n| ^ | ^ |\n',
    '| a | b |\n| ^ | c |\n',
    '| \\^ | b |\n',
    '| a | b |\n|---|---|\n| ^ | c |\n',
    '```\n| ^ | b |\n```\n',
  ])('does not report resolved or literal markers in %s', (source) => {
    expect(findings(source)).toEqual([])
  })

  it('uses UTF-16 offsets after an astral character in a quote', () => {
    const source = '😀\n> | ^ | b |\n'
    expect(findings(source)).toMatchObject([{
      line: 2,
      column: 5,
      start: source.indexOf('^'),
      end: source.indexOf('^') + 1,
    }])
  })
})
