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
    ['nested loose item, two deep', '- outer\n\n  - Bar\n\n    Foo\n   ---\n'],
    ['nested loose item, three deep', '- outer\n\n  - middle\n\n    - Bar\n\n      Foo\n     ---\n'],
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
