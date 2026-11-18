import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

describe('C2-B-059 C2-B-222: an unclosed fence after a description continuation', () => {
  const source = ':: t\n: n\n+\n```\ne'

  it('rewrites the marker and explains the final code line feed', () => {
    const result = upgrade(source)
    expect(result.output).toBe(':: t\n: n\n\n  ```\n  e')
    expect(result.check).toBe('explained')
    expect(result.records.map((record) => record.entry)).toContain('U-204')
    expect(result.records.find((record) => record.entry === 'U-204')?.class).toBe('report')
  })

  it('keeps an unrelated table difference as a mismatch', () => {
    const result = upgrade(`{aligns="right,,center" widths="25,50,25"}\n| A | B | C |\n\n${source}`)
    expect(result.check).toBe('mismatch')
    expect(result.records.map((record) => record.entry)).toContain('upgrade-mismatch')
  })

  it('does not attribute another final fence to the continuation', () => {
    const result = upgrade(':: t\n: n\n+\n```\ne\n````\n\n~~~\nx')
    expect(result.check).toBe('mismatch')
  })
})
