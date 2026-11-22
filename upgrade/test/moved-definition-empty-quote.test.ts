import { describe, expect, it } from 'vitest'
import { canWriteUpgrade, upgrade } from '../src/index.ts'

describe('a moved definition that left an empty nested quote', () => {
  it('keeps the old quote chain and drops the unclaimed following quote line', () => {
    const source = '> - > para\n> tail\n> >   >  [r]: /u\n> \n[r][]\n'
    const result = upgrade(source)
    expect(result.output).toBe('> - > para\n> tail\n>\n> >   >\n\n[r]: /u\n\n[r][]\n')
    expect(result.records.some((record) => record.entry === 'U-038')).toBe(true)
    expect(canWriteUpgrade(result)).toBe(true)
  })
})
