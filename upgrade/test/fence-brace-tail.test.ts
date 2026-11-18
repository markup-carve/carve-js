import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/upgrade.ts'

describe('U-037 discarded fence opener tail', () => {
  it('removes a discarded brace tail for any code body', () => {
    for (const body of ['a', 'other']) {
      const result = upgrade(`\`\`\`js{1,3}\n${body}\n\`\`\`\n`)
      expect(result.output).toBe(`\`\`\`js\n${body}\n\`\`\`\n`)
      expect(result.check).toBe('pass')
      expect(result.records.map((record) => record.entry)).toContain('U-037')
    }
  })

  it('leaves a brace shaped string in code content alone', () => {
    const source = '```js\n{1,3}\n```\n'
    expect(upgrade(source).output).toBe(source)
  })
})
