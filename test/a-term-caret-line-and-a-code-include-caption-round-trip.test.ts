import { describe, it, expect } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

// carve-js#4135 rows 856 and 872-12.
describe('the writer keeps a term caret line and a code include caption gap', () => {
  it.each([
    '- [ ] - [ ] :: t\n      ^ ap\n     ^ cap\n',
    '- :: t\n^ ap\n',
    '> - :: t\n> ^ ap\n',
  ])('escapes a caret that would end the term: %j', (src) => {
    const out = carveToCarve(src)
    expect(out).toMatch(/\\\^ ap/)
    expect(carveToHtml(out)).toBe(carveToHtml(src))
    expect(carveToCarve(out)).toBe(out)
  })

  it('leaves a paragraph caret after a term bare', () => {
    expect(carveToCarve(':: t\n\n^ ap\n')).toBe(':: t\n\n^ ap\n')
  })

  it.each([
    ['- {{ y @code:js }}\n\n  ^ c\n', '- {{ y @code:js }}\n\n  ^ c\n'],
    ['- {{ y @code:js }}\n  ^ c\n', '{loose}\n- {{ y @code:js }}\n  ^ c\n'],
  ])('keeps the blank line before a code include caption in a list item: %j', (src, out) => {
    expect(carveToCarve(src)).toBe(out)
    expect(carveToCarve(out)).toBe(out)
  })
})
