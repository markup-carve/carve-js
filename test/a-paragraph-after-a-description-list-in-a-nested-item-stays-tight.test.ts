import { describe, it, expect } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

describe('a paragraph after a description list in a tight nested item', () => {
  it.each([
    ['a term alone', '- - :: t\n    ^ ap\n', '- - :: t\n  +\n  ^ ap\n'],
    ['a description, then a term', '- - :: t\n    : d\n    :: u\n    ^ ap\n', '- - :: t\n    : d\n    :: u\n  +\n  ^ ap\n'],
    ['in a quote', '> - - :: t\n>     ^ ap\n', '> - - :: t\n>   +\n>   ^ ap\n'],
  ])('keeps the item tight: %s', (_name, source, written) => {
    expect(carveToCarve(source)).toBe(written)
    expect(carveToHtml(written)).toBe(carveToHtml(source))
    expect(carveToCarve(written)).toBe(written)
  })
})
