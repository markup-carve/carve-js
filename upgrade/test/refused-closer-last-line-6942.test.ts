import { describe, expect, it } from 'vitest'
import { html01, html02 } from '../src/engines.ts'
import { upgrade } from '../src/index.ts'

const html = (source: string) => html02(source, false).replace(/ data-source-line="\d+"/gu, '')

// U-049 (C2-B-109): 0.1 kept a bare run indented past the opener in the body, also on the block's
// last line; the closer is added after the blank lines 0.1 kept (C2-B-113). At the document end with
// no kept blank line the unclosed fence already ends there, and only the opener changes (U-242).
describe('U-049: a refused closer on the last line of its block', () => {
  const cases: [string, string, string, string[]][] = [
    ['description item, corpus 901', ':: t\n: . ```\n     ```\n\n', ':: t\n: . ````\n     ```\n\n    ````\n', ['U-049', 'U-049']],
    ['top-level fence', '```\n ```\n', '````\n ```\n', ['U-242']],
    ['top-level fence with a trailing blank', '```\na\n ```\n\n', '````\na\n ```\n\n````\n', ['U-049', 'U-049']],
    ['list item', '- ```\n   ```\n', '- ````\n   ```\n', ['U-242']],
    ['quote', '> ```\n>  ```\n', '> ````\n>  ```\n', ['U-242']],
    ['description', ':: t\n: ```\n   ```\n', ':: t\n: ````\n   ```\n', ['U-242']],
    ['list item before a paragraph', '- ```\n   ```\n\nx\n', '- ````\n   ```\n\n  ````\nx\n', ['U-049', 'U-049']],
    ['quote before a paragraph', '> ```\n>  ```\n\nx\n', '> ````\n>  ```\n> ````\n\nx\n', ['U-049', 'U-049']],
  ]
  for (const [name, source, output, ids] of cases) {
    it(name, () => {
      const result = upgrade(source)
      expect(result.output).toBe(output)
      expect(result.check).toBe('pass')
      expect(result.records.map((record) => record.entry)).toEqual(ids)
      expect(html(result.output)).toBe(html01(source))
    })
  }
})

describe('U-049: generated refused closers on the last line', () => {
  const containers: [string, string, string][] = [
    ['top', '', ''],
    ['list', '- ', '  '],
    ['quote', '> ', '> '],
    ['description', ':: t\n: ', '  '],
    ['description list', ':: t\n: . ', '    '],
  ]
  const variants: [string, string][] = []
  for (const [kind, first, prefix] of containers) {
    for (const length of [3, 4, 5]) {
      for (const above of [false, true]) {
        for (const blanks of [0, 1, 2]) {
          for (const shift of [1, 2, 3]) for (const tail of ['', '\nx\n']) {
            const fence = '`'.repeat(length)
            const lines = [first + fence]
            if (above) lines.push(prefix + 'a')
            lines.push(prefix + ' '.repeat(shift) + fence)
            for (let count = 0; count < blanks; count++) lines.push(prefix.trimEnd())
            const name = `${kind} ${length} above=${above} blanks=${blanks} shift=${shift} tail=${tail !== ''}`
            variants.push([name, lines.join('\n') + '\n' + tail])
          }
        }
      }
    }
  }

  it('covers at least 200 variants', () => expect(variants.length).toBeGreaterThanOrEqual(200))

  for (const [name, source] of variants) {
    it(name, () => {
      const result = upgrade(source)
      expect(result.check).toBe('pass')
      const ids = result.records.map((record) => record.entry)
      expect(ids.includes('U-049') || ids.includes('U-242')).toBe(true)
      expect(html(result.output)).toBe(html01(source))
      expect(upgrade(result.output).output).toBe(result.output)
    })
  }
})
