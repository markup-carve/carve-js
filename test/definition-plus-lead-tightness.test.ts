import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// carve#5466: a note definition's `+` belongs to the invisible lead (§17 L1, CARVE-P9-013 point 3).
describe('a note definition with + in a list item lead', () => {
  it.each([
    ['shape A', '- [^a]: +\n  flush\n\n  see[^a]\n', '<li>see'],
    ['shape B', '- [^a]: x\n\n  [^b]: d2\n  flush\n\n  see[^a]\n', '<li>see'],
    ['ordered item', '1. [^a]: +\n   flush\n\n   see[^a]\n', '<li>see'],
    ['task item', '- [ ] [^a]: +\n  flush\n\n  see[^a]\n', 'see'],
    ['nested item', '- top\n  - [^a]: +\n    flush\n\n    see[^a]\n', '<li>see'],
  ])('%s keeps the item tight', (_name, source, tight) => {
    const html = carveToHtml(source)
    expect(html).toContain(tight)
    expect(html).not.toMatch(/<li[^>]*>(?:<input[^>]*>)?\s*<p>see/)
  })

})

// A lazy line belongs to its definition, so the blank before that definition still parts the siblings (§17 L1).
describe('a lazy line of a definition in a list item', () => {
  it.each([
    ['without a lazy line', '- [^a]: xa\n\n  [^b]: xb\n- next\n'],
    ['with a lazy line', '- [^a]: xa\n\n  [^b]: xb\n  see[^a]\n- next\n'],
    ['with a lazy line of a quoted body', '- [^a]: xa\n\n  [^b]: > qb\n  flb\n- next\n'],
    ['with a lazy line of a listed body', '- [^a]: xa\n\n  [^f]: x\n    - kid\n  see\n- next\n'],
  ])('%s keeps the list loose', (_name, source) => {
    expect(carveToHtml(source)).toContain('<li><p>next</p></li>')
  })

  it('a block-shaped note body takes no lazy line', () => {
    const html = carveToHtml('- [^a]: x\n\n  [^f]: # head\n  see\n- next\n')
    expect(html).toContain('<li>see</li>')
    expect(html).toContain('<li>next</li>')
  })
})
