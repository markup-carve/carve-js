import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, parse } from '../src/index.js'

function withoutPos(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutPos)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== 'pos' && key !== 'srcByteLength')
      .map(([key, child]) => [key, withoutPos(child)]),
  )
}

describe('guarded em dashes in item and description paragraphs', () => {
  const cases = [
    ['heading followed by a loose paragraph', '1.     ## Foo\n\n       Foo\n   ---\n'],
    ['ordered loose item', '1. Bar\n\n   Foo\n ---\n'],
    ['bullet loose item', '- Bar\n\n  Foo\n ---\n'],
    ['tight item', '1. Bar\n   Foo\n ---\n'],
    ['nested loose item, two deep', '- outer\n\n  - Bar\n\n    Foo\n ---\n'],
    ['nested loose item, three deep', '- outer\n\n  - middle\n\n    - Bar\n\n      Foo\n ---\n'],
    ['tight outer and loose inner', '- parent\n  - Bar\n\n    Foo\n ---\n'],
    ['tight outer and tight inner', '- parent\n  - Bar\n    Foo\n ---\n'],
    ['tight nested item with a sibling', '- parent\n  - Bar\n    Foo\n ---\n  - Baz\n'],
    ['tight nested item, three deep', '- a\n  - b\n    - Bar\n      Foo\n ---\n'],
    ['tight nested item in a quote', '> - a\n>   - Bar\n>     Foo\n>  ---\n'],
    ['nested loose item, four deep', '- outer\n\n  - second\n\n    - third\n\n      - Bar\n\n        Foo\n ---\n'],
    ['ordered nested item', '1. parent\n   1. Bar\n\n      Foo\n ---\n'],
    ['heading first nested item', '- parent\n  - ## Foo\n\n    Foo\n ---\n'],
    ['nested item in a quote', '> - parent\n>   - ## Foo\n>\n>     Foo\n>  ---\n'],
    ['item inside a description', ':: term\n: Bar\n\n  - Baz\n\n    Foo\n ---\n'],
    ['description inside an item', '- Bar\n  :: term\n  : Baz\n\n    Foo\n ---\n'],
    ['four hyphens', '- Bar\n\n  Foo\n ----\n'],
    ['loose item in a quote', '> 1. Bar\n>\n>    Foo\n>  ---\n'],
    ['description paragraph', ':: term\n: Bar\n\n  Foo\n ---\n'],
    ['div inside an item', '- Bar\n\n  :::\n  Foo\n   ---\n  :::\n'],
    ['guarded line in the middle', '- Bar\n\n  Foo\n ---\n   Bar\n'],
  ] as const

  for (const [name, source] of cases) {
    it(name, () => {
      const formatted = carveToCarve(source)
      expect(carveToCarve(formatted)).toBe(formatted)
      expect(carveToHtml(formatted)).toBe(carveToHtml(source))
      expect(withoutPos(parse(formatted))).toEqual(withoutPos(parse(source)))
      if (name === 'heading followed by a loose paragraph') {
        expect(formatted).toBe('1. ## Foo\n\n   Foo\n ---\n')
      }
    })
  }
})
