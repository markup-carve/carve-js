import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

describe('C2-I-005 C2-I-035, U-365: a tag name at a deletion closer', () => {
  it('escapes the inner brace from the parsed deletion, even with following content', () => {
    const source = '{-{#x-}\n\nplain\n'
    const result = upgrade(source)
    expect(result.output).toBe('{-\\{#x-}\n\nplain\n')
    expect(result.check).toBe('pass')
    expect(result.records.map((record) => record.entry)).toContain('U-365')
  })

  it.each(['```\n{-{#x-}\n```\n', '{_{#x_}\n'])('leaves a near miss unchanged: %s', (source) => {
    expect(upgrade(source).output).toBe(source)
  })
})
