import { describe, expect, it } from 'vitest'
import { canWriteUpgrade, upgrade } from '../src/index.ts'

describe('old description marker columns', () => {
  it('keeps a definition and its following sibling in their old owners', () => {
    const source = '- intro\n  :: term\n   : body\n\n    text\n'
    const result = upgrade(source)
    expect(result.output).toBe('- intro\n\n  :: term\n  : body\n\n  text\n')
    expect(canWriteUpgrade(result)).toBe(true)
    expect(result.records.map(({ entry }) => entry)).toContain('U-435')
  })
})
