import { describe, expect, it } from 'vitest'
import { format, parse, treesEqual } from '../src/index.ts'

// carve-js#5460, C2-B-015: a list marker interrupts a paragraph only where its container is an item, so a later line
// of a paragraph in a div or another fenced container inside an item takes no backslash.
const SOURCES = [
  '- x\n\n  ::: div\n  a\n  * li\n  :::\n',
  '- x\n\n  ::: div\n  a\n  1. li\n  :::\n',
  '- x\n\n  ::: note\n  a\n  * li\n  :::\n',
  '1. x\n\n   ::: toc\n   a\n   1. li\n   :::\n',
]

describe('a list marker line in a fenced container inside an item (carve-js#5460)', () => {
  it.each(SOURCES)('keeps %j as written', (source) => {
    expect(format(source)).toBe(source)
    expect(treesEqual(parse(format(source)), parse(source))).toBe(true)
  })

  it('still escapes the marker on a later line of the item paragraph itself', () => {
    expect(format('- x\n  \\* li\n')).toBe('- x\n  \\* li\n')
  })
})
