import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

describe('C2-B-059 and C2-B-076 detached description continuation', () => {
  it('U-123 replaces the marker with a boundary and moves the next paragraph to column zero', () => {
    const result = upgrade(':: term\n:  intro\n+\n  more\n')
    expect(result.output).toBe(':: term\n:  intro\n\nmore\n')
    expect(result.check).toBe('pass')
    expect(result.records.map((record) => record.entry)).toContain('U-123')
  })
})
