import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { carveToHtml } from '../src/index.js'

describe('sibling terms after a nested marker-line term', () => {
  it.each([
    '- - - :: t\n   : a\n    :: sibling\n    tail\n',
    '* * * :: t\n   : a\n    :: sibling\n    tail\n',
    '> - - - :: t\n>    : a\n>     :: sibling\n>     tail\n',
  ])('keeps the sibling in the item whose content column it reaches', source => {
    const html = carveToHtml(source)
    expect(html).toMatch(/<\/dl>\s*<\/li>\s*<\/ul>\s*<dl>\s*<dt>sibling/)
  })
})

const variants = JSON.parse(readFileSync(new URL('./fixtures/sibling-term-item-columns.json', import.meta.url), 'utf8')) as { source: string; expected: string }[]

it.each(variants)('preserves source columns in $source', ({ source, expected }) => {
  expect(carveToHtml(source)).toBe(expected)
})
