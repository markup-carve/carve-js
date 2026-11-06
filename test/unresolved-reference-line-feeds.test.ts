import { describe, expect, it } from 'vitest'
import { carveToAnsi, carveToPlainText } from '../src/index.js'

const cases = [
  { source: '[a\\\nb][missing]\n', expected: '[a\\\nb][missing]\n' },
  { source: '::: |\n[a\nb][missing]\n:::\n', expected: '[a\nb][missing]\n' },
  { source: '[a `x\ny`][missing]\n', expected: '[a `x\ny`][missing]\n' },
  { source: '[a\nb][missing]\n', expected: '[a b][missing]\n' },
  { source: '[a\\\nb `x\ny`\nz][missing]\n', expected: '[a\\\nb `x\ny` z][missing]\n' },
  { source: '![a\\\nb][missing]\n', expected: '![a\\\nb][missing]\n' },
  { source: '![a `x\ny`][missing]\n', expected: '![a `x\ny`][missing]\n' },
  { source: '::: |\n![a\nb][missing]\n:::\n', expected: '![a\nb][missing]\n' },
  { source: '{.hardbreaks}\n::: box\n![a\nb][missing]\n:::\n', expected: '![a b][missing]\n' },
  { source: '[a\r\nb\r\nb\\\r\nc][missing]\r\n', expected: '[a b b\\\nc][missing]\n' },
  { source: '[é\\\nb][missing]\n', expected: '[é\\\nb][missing]\n' },
  { source: '[x][`ab\ncd`]\n', expected: '[x][`ab cd`]\n' },
  { source: '[a `x]y\nz`][missing]\n', expected: '[a `x]y\nz`][missing]\n' },
  { source: '[a\n%% comment\nb `x\ny`\nz][missing]\n', expected: '[a b `x\ny` z][missing]\n' },
  { source: '[a {% `x\ny` %}][missing]\n', expected: '[a {% `x\ny` %}][missing]\n' },
  { source: '[a [x][`foo\nbar`]][missing]\n', expected: '[a [x][`foo bar`]][missing]\n' },
] as const

describe('unresolved reference line feeds', () => {
  for (const { source, expected } of cases) {
    it(`preserves only parsed hard or verbatim breaks in ${JSON.stringify(source)}`, () => {
      expect(carveToPlainText(source)).toBe(expected)
      expect(carveToAnsi(source)).toBe(expected)
    })
  }

  it('keeps authored breaks when source positions are disabled', () => {
    for (const source of [
      '[a\\\nb `x\ny`][missing]\n',
      '[a \\\\`x\ny`][missing]\n',
      '![a \\\\`x\ny`][missing]\n',
      '[a `x\ny\\`][missing]\n',
      '![a `x\ny\\`][missing]\n',
    ]) {
      expect(carveToPlainText(source, { positions: false })).toBe(source)
      expect(carveToAnsi(source, { positions: false })).toBe(source)
    }
  })

  it('keeps hard and verbatim breaks across 1,000 reference variants', () => {
    const bodies = [
      ['a\\\nb', 'a\\\nb'],
      ['a\nb', 'a b'],
      ['a `x\ny`', 'a `x\ny`'],
      ['*a\\\nb*', '*a\\\nb*'],
      ['a\\\nb\nc', 'a\\\nb c'],
    ] as const
    let checked = 0
    for (let label = 0; label < 20; label++) {
      for (let columns = 0; columns < 10; columns++) {
        for (const [body, rendered] of bodies) {
          const image = label % 2 === 1 ? '!' : ''
          const prefix = 'z'.repeat(columns)
          const input = `${image}[${prefix}${body}][missing${label}]\n`
          const expected = `${image}[${prefix}${rendered}][missing${label}]\n`
          expect(carveToPlainText(input)).toBe(expected)
          expect(carveToAnsi(input)).toBe(expected)
          checked++
        }
      }
    }
    expect(checked).toBe(1000)
  })
})
