import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

describe('C2-B-123 C2-H-043: trailing spaces in one line block line', () => {
  const source = '::: |\na  '

  it('checks the loss of the old trailing no-break spaces', () => {
    const result = upgrade(source)
    expect(result.check).toBe('explained')
    expect(result.records.map((record) => record.entry)).toContain('U-130')
  })

  it.each(['::: |\na  \n', '::: |\na  \nb  \n', '::: |\na  \n:::'])
  ('checks trailing spaces with a final line feed or another line: %s', (input) => {
    expect(upgrade(input).check).toBe('explained')
  })

  it('keeps an unrelated table difference as a mismatch', () => {
    const result = upgrade(`|= ^|\n\n${source}`)
    expect(result.check).toBe('mismatch')
    expect(result.records.map((record) => record.entry)).toContain('upgrade-mismatch')
  })
})
