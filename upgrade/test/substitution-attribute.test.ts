import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

describe('C2-I-062 C2-I-043 replacement attribute', () => {
  it('keeps the literal attribute in a real source with a following editorial comment', () => {
    const source = '{~a~>b~}{.k} c\n\n{#note#}{.k} c\n'
    const result = upgrade(source)
    expect(result.check).toBe('pass')
    expect(result.output).toBe('{-a-}{+b+}\\{.k} c\n\n{#note#}\\{.k} c\n')
    expect(result.records.map((record) => record.entry)).toContain('U-200')
  })
})
