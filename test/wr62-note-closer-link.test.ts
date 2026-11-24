import { expect, test } from 'vitest'
import { format, parse, treesEqual } from '../src/index.ts'

test('a text note closer keeps the following link caret bare', () => {
  for (const separator of ['\n', ' ']) {
    for (const [link, expected] of [
      ['[^](u)', '[^](u)'],
      ['[^][n]', '[^][n]'],
      ['[\\^][n]', '[\\^][n]'],
      ['[^][]', '[^][]'],
      ['[\\^][]', '[\\^][]'],
    ]) {
      const source = `^[\\]${separator}${link}`
      const written = `^[\\]${separator}${expected}\n`
      expect(format(source)).toBe(written)
      expect(format(written)).toBe(written)
      expect(treesEqual(parse(source), parse(written))).toBe(true)
    }
  }
})
