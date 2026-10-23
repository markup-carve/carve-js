import { describe, it, expect } from 'vitest'
import { carveToCarve, carveToHtml, parse } from '../src/index.js'

/*
 * markup-carve/carve-js#3512, corpus 590-3: a fence that follows a nested list
 * in a tight item is written without blank lines (PART 11 §7e2, CARVE-P11-074).
 * The tightness readback used to parse the fence closer with its writer
 * sentinel still in place, failed, and fell back to the blank-line spelling.
 */
const cases: Array<[string, string, string]> = [
  ['a heading-tailed sub-list', '- a\n    - # h\n  ~~~\nafter\n', '- a\n  - # h\n  ```\n  ```\n\nafter\n'],
  ['a paragraph-tailed sub-list', '- a\n  - x\n  ```\n  ```\n', '- a\n  - x\n  ```\n  ```\n'],
  ['a fence with content', '- a\n  - # h\n  ```\n  code\n  ```\n', '- a\n  - # h\n  ```\n  code\n  ```\n'],
]

const strip = (source: string): string =>
  JSON.stringify(parse(source), (key, value) => (key === 'pos' || key === 'srcByteLength' ? undefined : value))

describe('a fence after a nested list in a tight item', () => {
  for (const [name, source, expected] of cases) {
    it(`is written compact below ${name}`, () => {
      const once = carveToCarve(source)
      expect(once).toBe(expected)
      expect(carveToCarve(once)).toBe(once)
      expect(carveToHtml(once)).toBe(carveToHtml(source))
      expect(strip(once)).toBe(strip(source))
    })
  }
})
