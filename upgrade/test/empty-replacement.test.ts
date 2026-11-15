import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

describe('C2-I-062 C2-W-116 empty replacement sides', () => {
  it('reports the real explanation with empty deletion and insertion', () => {
    const source = '{~a~>~} deletes, {~~>b~} inserts, and {~~>~} still does both to nothing.\n'
    const result = upgrade(source)
    expect(result.output).toBe(source)
    expect(result.check).toBe('explained')
    expect(result.records.filter((record) => record.entry === 'U-198')).toHaveLength(3)
    expect(result.records.map((record) => record.entry)).not.toContain('upgrade-mismatch')
  })
})
