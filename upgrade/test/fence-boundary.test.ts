import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

describe('C2-B-057 C2-B-109 C2-B-111 fence ownership', () => {
  const cases: [string, string][] = [
    ['smallest trailing blank payload', ['```', '', ''].join('\n')],
    ['sibling item after a blank payload', ['- ```', '  b', '', '- s', ''].join('\n')],
    ['nested item with a blank payload', ['- - ```', '', 'tail', ''].join('\n')],
    ['indented apparent closer', ['```', 'code', '  ```', 'still code', '```', ''].join('\n')],
    ['nested fence followed by a parent code block',
      ['- outer', '  - head', '    ```', '    a', '   ```', '', '  tail', ''].join('\n')],
  ]
  for (const [name, source] of cases) {
    it(name, () => {
      const result = upgrade(source)
      expect(result.check).toBe('pass')
      expect(result.records.some((record) => record.entry === 'upgrade-mismatch')).toBe(false)
      expect(result.output).not.toBe(source)
    })
  }
})
