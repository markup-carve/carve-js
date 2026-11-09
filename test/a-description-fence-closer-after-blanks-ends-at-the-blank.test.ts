import { describe, it, expect } from 'vitest'
import { parse } from '../src/index.js'

// The synthetic closer of an own-line `+` fence that runs into a dedent sits on
// the last blank it kept, not on the line after it (carve corpus 1016-2).
describe('an own-line plus fence closed at a dedent', () => {
  for (const blanks of [1, 2, 3]) {
    it(`ends the description before the next block (${blanks} blank)`, () => {
      const src = ':: t\n: n\n+\n```\na\n  b\n' + '\n'.repeat(blanks) + 'see\n'
      const doc = parse(src)
      const [list, paragraph] = doc.children as Array<{ type: string, pos: { startOffset: number, endOffset: number } }>
      expect(list!.type).toBe('definition_list')
      expect(paragraph!.type).toBe('paragraph')
      expect(list!.pos.endOffset).toBeLessThanOrEqual(paragraph!.pos.startOffset)
      expect(src.slice(paragraph!.pos.startOffset, paragraph!.pos.endOffset)).toBe('see')
    })
  }
})
