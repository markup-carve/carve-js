import { describe, expect, it } from 'vitest'
import { carveToHtml, parse } from '../src/index.js'

// markup-carve/carve#1718. A `::: >` container is a second spelling of the
// block quote: the tree it produces is the one the `>`-prefixed form produces,
// so every assertion here compares the two spellings rather than pinning HTML.

describe('a fenced block quote', () => {
  it('renders the element the prefixed form renders', () => {
    expect(carveToHtml('::: >\nhello\n:::\n')).toBe(carveToHtml('> hello\n'))
  })

  it('nests in itself at constant fence width, leaving nothing behind', () => {
    const nested = ['::: >', 'outer', '', '::: >', 'inner', ':::', ':::', ''].join('\n')
    const doc = parse(nested)
    expect(doc.children.map((child) => child.type)).toEqual(['block_quote'])
    expect(carveToHtml(nested)).toBe(carveToHtml('> outer\n>\n> > inner\n'))
  })
})
