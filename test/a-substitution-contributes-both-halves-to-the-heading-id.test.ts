import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// CARVE-P2-004: a substitution carries both halves as literal text.
const html = (src: string) => carveToHtml(src).trimEnd()

describe('a substitution contributes both halves to the heading id', () => {
  it('slugs the deleted and the inserted text', () => {
    expect(html('# x {~a~>b~}')).toContain('<section id="x-ab">')
    expect(html('# {~*a* `c`~>b $`x`~}')).toContain('<section id="a-cb-x">')
  })

  it('resolves the heading reference by both halves', () => {
    expect(html('# x {~a~>b~}\n\n[x ab][]')).toContain('<a href="#x-ab">x ab</a>')
  })

  it('names a task checkbox by both halves', () => {
    expect(html('- [ ] x {~a~>b~}')).toContain('aria-label="x ab"')
  })
})
