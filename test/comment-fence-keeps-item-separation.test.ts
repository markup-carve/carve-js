import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('an invisible comment fence preserves item separation', () => {
  for (const base of [2, 6]) {
    for (const closer of [2, 4]) {
      it(`keeps the item loose with opener at ${base} and closer at ${closer}`, () => {
        const source =
          '- head\n\n' +
          ' '.repeat(base) +
          '%%%\n' +
          ' '.repeat(base) +
          'a\n' +
          ' '.repeat(closer) +
          '%%%\n\n    tail\n'
        // CARVE-P9-030 preserves separation; comment_block_close permits an indented closer (§28).
        expect(carveToHtml(source)).toBe('<ul>\n  <li><p>head</p>\n    <p>tail</p>\n  </li>\n</ul>')
      })
    }
  }
})
