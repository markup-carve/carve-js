import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const h = (s: string) => carveToHtml(s)

/**
 * Task-list states (grammar PART 2 task_state; matches djot-php): `x`
 * and `X` render a checked checkbox; ` `, `-`, `_`, `>`, `?` are all
 * accepted and render an unchecked checkbox.
 */
describe('task-list states', () => {
  it('renders [x]/[X] as checked', () => {
    expect(h('- [x] a')).toContain('<input type="checkbox" checked disabled> a')
    expect(h('- [X] b')).toContain('<input type="checkbox" checked disabled> b')
  })

  it('renders [ ] as an unchecked checkbox', () => {
    expect(h('- [ ] a')).toContain('<input type="checkbox" disabled> a')
  })

  it.each(['-', '_', '>', '?'])('renders [%s] as an unchecked checkbox', (s) => {
    const html = h(`- [${s}] item`)
    expect(html).toContain('<input type="checkbox" disabled> item')
    expect(html).not.toContain('checked')
  })

  it('still treats a non-state bracket as plain text', () => {
    // `[ab]` is not a single-char task state.
    expect(h('- [ab] x')).toBe('<ul>\n  <li>[ab] x</li>\n</ul>')
  })
})
