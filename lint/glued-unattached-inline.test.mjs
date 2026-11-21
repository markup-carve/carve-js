import { describe, expect, it } from 'vitest'
import { lint } from './lint.ts'

describe('unattached inline attribute runs', () => {
  for (const [source, range] of [
    ['a {.a}{.b}\n', [2, 10]],
    ['`c` {.a}{.b}\n', [4, 12]],
    ['a {.a}{.b}{.c}\n', [2, 14]],
    ['a {.a} {.b}\n', [2, 6]],
  ]) {
    it(`reports a glued run at ${range} in ${JSON.stringify(source)}`, () => {
      const found = lint(source).filter((item) => item.code === 'unattached-inline-attribute')
      expect(found[0] && [found[0].range.startOffset, found[0].range.endOffset]).toEqual(range)
      expect(found).toHaveLength(source.includes('} {') ? 2 : 1)
    })
  }
})
