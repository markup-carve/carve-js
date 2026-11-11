import { describe, expect, it } from 'vitest'
import { lintCarve } from '../src/lint.js'

const plusFindings = (source: string): string[] => lintCarve(source)
  .filter(w => w.rule.includes('continuation-marker') || w.rule === 'duplicate-footnote-definition')
  .map(w => `${w.line}:${w.column} ${w.rule}`)

// carve#5953 ruling A: a losing duplicate's marker-line `+` is the first-block form.
describe('a losing duplicate footnote definition marker-line +', () => {
  it.each([
    ['[^n]: +\n[^n]: +\n\n  para\n\nsee[^n]\n',
      ['1:7 continuation-marker-refused', '2:1 duplicate-footnote-definition', '2:7 continuation-marker-refused']],
    ['[^a]: x\n[^a]: +\n flush\n\nsee[^a]\n',
      ['2:1 duplicate-footnote-definition', '2:7 continuation-marker-refused']],
    ['> [^n]: +\n> [^n]: +\n\nsee[^n]\n',
      ['1:9 continuation-marker-refused', '2:3 duplicate-footnote-definition', '2:9 continuation-marker-refused']],
    ['[^a]: +\n[^a]: +\n[^a]: +\n\n  b\n\nsee[^a]\n',
      ['1:7 continuation-marker-refused', '2:1 duplicate-footnote-definition', '2:7 continuation-marker-refused',
        '3:1 duplicate-footnote-definition', '3:7 continuation-marker-refused']],
  ])('%j', (source, expected) => {
    expect(plusFindings(source)).toEqual(expected)
  })

  it('never reports the own-line rule on a losing marker line', () => {
    for (const source of ['[^n]: +\n[^n]: +\n- b\n\n[^n]\n', '[^a]: +\n[^b]: x\n[^a]: +\n\n  p\n\n[^a][^b]\n']) {
      expect(lintCarve(source).filter(w => w.rule === 'refused-continuation-marker')).toEqual([])
    }
  })
})
