import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

const punctuation = `!"#$%&'()*+,-./:;<=>?@[\\]^_\`{|}~`

describe('canonical literal backslashes', () => {
  it('keeps a backslash bare before letters and non-ASCII characters', () => {
    for (const value of ['\\a', 'a\\b', '\\«', '\\é']) {
      const source = `${value}\n`
      expect(carveToCarve(source)).toBe(source)
    }
  })

  it('preserves the tree for every ASCII punctuation neighbor', () => {
    for (const char of punctuation) {
      const source = `x\\${char}y\n`
      const written = carveToCarve(source)
      expect(carveToHtml(written), char).toBe(carveToHtml(source))
      expect(carveToCarve(written), char).toBe(written)
    }
  })

  it('handles doubled and terminal backslashes', () => {
    for (const source of ['a\\\\b\n', 'a\\\\\n', 'a\\\n']) {
      const written = carveToCarve(source)
      expect(carveToHtml(written)).toBe(carveToHtml(source))
      expect(carveToCarve(written)).toBe(written)
    }
  })

  it('removes an idle marker escape after cell padding', () => {
    expect(carveToCarve('|\\= a |\n')).toBe('| = a |\n')
  })
})
