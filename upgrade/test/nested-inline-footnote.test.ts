import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

// C2-I-089 restores the 0.1 reading: inside a note a caret pair opens nothing, so U-202 is withdrawn.
describe('C2-I-089 nested inline footnotes', () => {
  for (const source of [
    'x ^[a ^[b] c]\n',
    'x ^[a ^[b ^[c] d] e]\n',
    '^[x ^[a](u) b]\n',
    '^[x ^[a]{.c} b]\n',
  ]) {
    it(`both versions read ${source.trim()} alike`, () => {
      const result = upgrade(source)
      expect([result.check, result.output, result.records]).toEqual(['pass', source, []])
    })
  }
})
