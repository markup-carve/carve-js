import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

describe('measured reports use the 0.1 parse', () => {
  it('reports U-130 for a line block with retained tabs', () => {
    const result = upgrade('::: |\n\tx\n:::')
    expect(result.records.map((record) => record.entry)).toContain('U-130')
  })

  it.each(['```\n::: |\n```\n\n$`\n', '{% ::: | %}\n\n$`\n', '%% ::: |\n$`\n'])(
    'does not treat a code or comment spelling as a line block: %s', (source) => {
      const result = upgrade(source)
      expect(result.records.map((record) => record.entry)).not.toContain('U-130')
      expect(result.records.map((record) => record.entry)).toContain('U-258')
      expect(result.check).toBe('explained')
    },
  )

  it('reports an include-looking run only when it is live paragraph text', () => {
    expect(upgrade('{{ d @lines:0 }}*a*\n').records.map((record) => record.entry)).toContain('U-011')
    for (const source of ['```\n{{ x }}\n```\n\n$`\n', '{% {{ x }} %}\n\n$`\n']) {
      const result = upgrade(source)
      expect(result.records.map((record) => record.entry)).not.toContain('U-011')
    }
  })
})
