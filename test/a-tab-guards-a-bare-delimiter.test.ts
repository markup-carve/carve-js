import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const h = (src: string) => carveToHtml(src).trim()

// CARVE-P3-013: a bare opener is not followed, and a bare closer not preceded,
// by `ws`, and PART 7 makes a tab one of Carve's four whitespace characters.
describe('a tab against a bare delimiter', () => {
  it.each(['/', '*', '_', '~', '='])('%s does not open before a tab', (d) => {
    expect(h(`a ${d}\tx${d} b`)).toBe(`<p>a ${d}\tx${d} b</p>`)
  })

  it.each(['/', '*', '_', '~', '='])('%s does not close after a tab', (d) => {
    expect(h(`a ${d}x\t${d} b`)).toBe(`<p>a ${d}x\t${d} b</p>`)
  })

  it('reads a tab-edged bold-italic as an emphasis holding literal stars, like a space', () => {
    expect(h('a /*\tx*/ b')).toBe('<p>a <em>*\tx*</em> b</p>')
    expect(h('a /* x*/ b')).toBe('<p>a <em>* x*</em> b</p>')
  })

  it('leaves a tab inside the content alone', () => {
    expect(h('a /x\ty/ b')).toBe('<p>a <em>x\ty</em> b</p>')
  })

  it('leaves the braced form free of the guard', () => {
    expect(h('a {/\tx/} b')).toBe('<p>a <em>\tx</em> b</p>')
  })
})
