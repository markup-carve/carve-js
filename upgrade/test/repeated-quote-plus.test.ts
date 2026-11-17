import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

describe('C2-B-015 and C2-B-059 repeated quote continuations', () => {
  for (const source of [
    '> - > +\n> - > +\n s\n',
    '> > - > +\n> > - > +\n>  s\n',
    '> > * > +\n> > * > +\n>  tail\n',
  ]) {
    it(`U-125 removes both markers in ${source.trim()}`, () => {
      const result = upgrade(source)
      expect(result.output).toBe(source.replaceAll('> +', '>'))
      expect(result.check).toBe('pass')
      expect(result.records.map((record) => record.entry)).toContain('U-125')
    })
  }
})
