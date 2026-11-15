import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

describe('C2-B-056 C2-B-059 list continuation', () => {
  const cases: [string, string][] = [
    ['smallest list quote item', '- > +\n'],
    ['star list quote item', '* > +\n'],
    ['table rows after a continuation', ['- +', '| a | b |', '| c | d |', '- next', ''].join('\n')],
    ['second table row after a continuation', ['- +', '| x | y |', '| z | w |', '- next', ''].join('\n')],
  ]
  for (const [name, source] of cases) {
    it(name, () => {
      const result = upgrade(source)
      expect(result.check).toBe('pass')
      expect(result.records.map((record) => record.entry)).toContain('U-122')
    })
  }
})
