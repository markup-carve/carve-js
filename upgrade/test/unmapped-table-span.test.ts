import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/upgrade.ts'

describe('table span marker without a matching map row', () => {
  it('does not attribute a literal span marker to the header creation row', () => {
    const result = upgrade('|= ^ |\n| x |\n')
    expect(result.check).toBe('mismatch')
    expect(result.records.map((record) => record.entry)).not.toContain('U-168')
    expect(result.records.find((record) => record.entry === 'upgrade-mismatch')?.message).toContain('no mapped row')
  })

  it('retains the U-168 report for a true header marker change', () => {
    expect(upgrade('|=||\n').records.map((record) => record.entry)).toContain('U-168')
  })
})
