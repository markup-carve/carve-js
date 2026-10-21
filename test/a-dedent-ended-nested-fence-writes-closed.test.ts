import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

const rows = [
  {
    name: 'tight bullet item',
    source: ['- outer', '  - head', '', '    ```', '    a', '   ```', '', '  tail', ''].join('\n'),
    expected: ['- outer', '  - head', '    ```', '    a', '    ```', '  ```', '', '  tail', '  ```', ''].join('\n'),
  },
  {
    name: 'nested closer with following text',
    source: ['- a', '  - b', '', '    ```', '    p', '  ```', '', '    tail', ''].join('\n'),
    expected: ['- a', '  - b', '    ```', '    p', '    ```', '  ```', '', '    tail', '  ```', ''].join('\n'),
  },
  {
    name: 'quoted tight item',
    source: ['> - outer', '>   - head', '>', '>     ```', '>     a', '>   ```', '>', '>   tail', ''].join('\n'),
    expected: ['> - outer', '>   - head', '>     ```', '>     a', '>     ```', '>   ```', '>', '>   tail', '>   ```', ''].join('\n'),
  },
] as const

describe('CARVE-P11-074 nested dedent-ended fence layout', () => {
  for (const row of rows) {
    it(row.name, () => {
      const formatted = carveToCarve(row.source)
      expect(formatted).toBe(row.expected)
      expect(carveToHtml(formatted)).toBe(carveToHtml(row.source))
      expect(carveToCarve(formatted)).toBe(formatted)
    })
  }
})
