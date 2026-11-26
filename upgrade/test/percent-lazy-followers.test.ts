import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

// C2-B-024, C2-B-123: 0.2 gives an unclosed comment block in a line block body no lazy line, so the lines 0.1 hid in
// it move to its column (edge-cases/0939 of the upgrade replay).
describe('U-129 moves the lines 0.1 hid in an unclosed comment block', () => {
  it('keeps the HTML of a lazy line after the comment block of a nested line block', () => {
    const result = upgrade('- a\n  - ::: |\n %%%\nb\n')
    expect(result.output).toBe('- a\n  - ::: |\n %%%\n b\n')
    expect(result.check).toBe('pass')
    expect(result.records.map((record) => record.entry)).toContain('U-129')
  })
})
