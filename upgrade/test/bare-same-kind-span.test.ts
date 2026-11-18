import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/upgrade.ts'

describe('U-273 same-kind bare emphasis', () => {
  it('escapes slashes the 0.1 span and following text kept literal', () => {
    const result = upgrade('/X /y/ z/\n')
    expect(result.output).toBe('/X \\/y/ z\\/\n')
    expect(result.check).toBe('pass')
    expect(result.records.map((record) => record.entry)).toContain('U-273')
  })

  it('leaves a simple span and code payload alone', () => {
    for (const source of ['/plain/\n', '`/X /y/ z/`\n']) expect(upgrade(source).output).toBe(source)
  })
})
