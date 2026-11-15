import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

describe('C2-B-027 C2-B-062 C2-H-036: list marker tab and loose first paragraph', () => {
  const source = '- \te\n\n\tf'

  it('checks the tab removal and sole-item paragraph change together', () => {
    const result = upgrade(source)
    expect(result.check).toBe('explained')
    expect(result.records.map((record) => record.entry)).toContain('U-153')
  })

  it('does not explain an unrelated table difference', () => {
    const result = upgrade(`{valigns=top,bottom widths=40}\n| a | b | c |\n\n${source}`)
    expect(result.check).toBe('mismatch')
    expect(result.records.map((record) => record.entry)).toContain('upgrade-mismatch')
  })
})
