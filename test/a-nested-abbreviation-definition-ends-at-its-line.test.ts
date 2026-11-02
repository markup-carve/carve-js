import { describe, it, expect } from 'vitest'
import { carveToAstJson, type Position } from '../src/index.js'

// PART 12 §4: a definition hoisted out of a nested container spans its own source line, no further.
describe('an abbreviation definition in a nested container ends at its line', () => {
  for (const source of [
    ':: t\n: d\n  - para\n    *[A]: b\nx\n',
    ':: t\n: d\n  - para\n    *[A]: b\n\nx\n',
    '- a\n  - para\n    *[A]: b\nx\n',
    '> - para\n>   *[A]: b\nx\n',
    '- para\n  *[A]: b\nx\n',
    ':: t\n: d\n  - para\n    *[A]: b',
    ':: t\r\n: d\r\n  - para\r\n    *[A]: b\r\nx\r\n',
  ]) {
    it(JSON.stringify(source), () => {
      const doc = carveToAstJson(source)
      const def = doc.children.find((node) => node.type === 'abbreviation_def')! as { pos: Required<Position> }
      expect(source.slice(def.pos.startOffset, def.pos.endOffset)).toBe('*[A]: b')
      const lineStart = source.lastIndexOf('\n', def.pos.startOffset - 1) + 1
      expect(def.pos.endColumn).toBe(def.pos.endOffset - lineStart + 1)
      const after = doc.children[doc.children.indexOf(def as never) + 1]
      if (after?.pos) expect(after.pos.startOffset).toBeGreaterThanOrEqual(def.pos.endOffset)
    })
  }
})
