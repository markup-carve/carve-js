import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

describe('C2-B-032 C2-B-059 quote continuation', () => {
  it('keeps two quote paragraphs inside a list item', () => {
    const source = ['- a', '  > q', '  +', '  para', ''].join('\n')
    const result = upgrade(source)
    expect(result.check).toBe('pass')
    expect(result.records.map((record) => record.entry)).toContain('U-125')
    expect(result.output).toBe(['- a', '', '  > q', '  >', '  > para', ''].join('\n'))
  })
})
