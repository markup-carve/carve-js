import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

describe('C2-I-079 and C2-I-085 unresolved reference attributes', () => {
  for (const source of [
    '[a][a]{.c}{#i}\n',
    '[a][b]{.c}{.d}\n',
    'x[a][a]{key=v}{#i}\n',
    '[a][]{#i}{.c}\n',
  ]) {
    it(`U-158 names the reordered literal attributes of ${source.trim()}`, () => {
      const result = upgrade(source)
      expect(result.check).toBe('explained')
      expect(result.records.map((record) => record.entry)).toContain('U-158')
    })
  }
})
