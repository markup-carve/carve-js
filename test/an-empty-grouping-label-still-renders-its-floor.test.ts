import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, parse } from '../src/index.js'

// carve-js#2236. `[]` and no grouping at all are different documents: the parser
// keeps them apart (`label: ''` against an absent field) and every other target
// writes the empty one back. The HTML renderer collapsed the two, so `:::[]`
// rendered as a bare `<div>` and the one element it spells was gone. This is the
// distinction the admonition title beside it already draws for `::: note ""`.
describe('an empty grouping label still renders its floor', () => {
  it('renders the floor for a bare div', () => {
    expect(carveToHtml(':::[]\n:::\n')).toBe('<div>\n  <p class="div-label"></p>\n</div>')
  })

  it('renders it for a named admonition and a directive', () => {
    expect(carveToHtml('::: note []\n:::\n')).toContain('<p class="div-label"></p>')
    expect(carveToHtml('::: figure []\n:::\n')).toContain('<p class="div-label"></p>')
  })

  it('still renders nothing when no grouping was written', () => {
    expect(carveToHtml(':::\n:::\n')).toBe('<div>\n\n</div>')
    expect(carveToHtml('::: note\n:::\n')).not.toContain('div-label')
  })

  it('keeps the two apart in the tree, which is why the renderer must too', () => {
    const labelled = parse(':::[]\n:::\n').children[0] as { label?: string }
    const plain = parse(':::\n:::\n').children[0] as { label?: string }
    expect(labelled.label).toBe('')
    expect(plain.label).toBeUndefined()
  })

  it('round-trips the empty grouping through the Carve writer', () => {
    expect(carveToCarve(':::[]\n:::\n')).toBe('::: []\n\n:::\n')
  })
})
