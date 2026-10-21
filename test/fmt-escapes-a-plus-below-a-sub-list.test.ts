import { describe, it, expect } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'
import { parse } from '../src/parse.js'

/*
 * carve-js#3362: a paragraph opening on a lone `+` line, written below a
 * sub-list, puts the `+` at the sub-list's marker column. Under the relative
 * continuation-marker rule (PART 9 §17 L3, carve#3421) a bare `+` there
 * attaches the line below it, so the writer escapes it (PART 11 §2).
 */

const shape = (src: string): string =>
  JSON.stringify(parse(src), (key, value) => {
    if (key === 'pos' || key === 'footnoteDefPos' || key === 'srcByteLength') return undefined
    if (value?.type === 'escaped_text') return { ...value, type: 'text' }
    return value
  })

const writes = (src: string, expected: string): void => {
  const out = carveToCarve(src)
  expect(out).toBe(expected)
  expect(carveToHtml(out)).toBe(carveToHtml(src))
  expect(shape(out)).toBe(shape(src))
  expect(carveToCarve(out)).toBe(out)
}

describe('a refused + written below a sub-list', () => {
  it.each([
    ['bullet below a fence', '- - ```\n\n\n  +\ntail\n', '- - ```\n\n    ```\n\n  \\+\n  tail\n'],
    ['ordered below a fence', '- 1. ```\n\n\n  +\ntail\n', '- 1. ```\n\n     ```\n\n  \\+\n  tail\n'],
    ['task below a fence', '- - [ ] ```js\n        x\n\n  +\ntail\n', '- - [ ] ```js\n        x\n\n    ```\n\n  \\+\n  tail\n'],
    ['bullet below a div', '- - ::: d\n  +\ntail\n', '- - ::: d\n\n    :::\n  \\+\n  tail\n'],
    ['inside a quote', '> - - ```\n>\n>\n>   +\n> tail\n', '> - - ```\n>\n>     ```\n>\n>   \\+\n>   tail\n'],
    ['in a loose item', '- - ```\n\n\n  +\ntail\n\n  more\n', '- - ```\n\n    ```\n\n  \\+\n  tail\n\n  more\n'],
  ])('escapes the + (%s)', (_name, src, expected) => writes(src, expected))

  it('leaves a + bare when no line follows it', () => {
    writes('- - ```\n  +\n\ntail\n', '- - ```\n    ```\n  +\n\ntail\n')
  })
})
