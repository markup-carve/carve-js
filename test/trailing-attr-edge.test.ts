import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const h = (s: string) => carveToHtml(s).trim()

describe('trailing attribute block edge cases', () => {
  // Regression: emphasis nodes used to drop a trailing attribute block.
  it('renders a trailing attribute block on emphasis', () => {
    expect(h('*x*{.real}')).toBe('<p><strong class="real">x</strong></p>')
    expect(h('/x/{#id}')).toBe('<p><em id="id">x</em></p>')
    expect(h('~x~{.a .b}')).toBe('<p><s class="a b">x</s></p>')
    expect(h('==x=={.h}')).toBe('<p><mark class="h">x</mark></p>')
  })

  // Regression: a line-leading image followed by an INVALID trailing block was
  // promoted to a standalone block image, swallowing the `{…}`. It must fall
  // through to a paragraph so the invalid block stays literal.
  it('keeps an empty/invalid trailing block after a line-leading image literal', () => {
    expect(h('![a](/i){=hl=}')).toBe('<p><img src="/i" alt="a">{=hl=}</p>')
    expect(h('![a](/i){???}')).toBe('<p><img src="/i" alt="a">{???}</p>')
    // whitespace-only is an empty block, not a real attribute block
    expect(h('![a](/i){ }')).toBe('<p><img src="/i" alt="a">{ }</p>')
  })

  // A bare image (optionally with a VALID attr block) is still a block image.
  it('keeps a bare / valid-attr image as a block image', () => {
    expect(h('![a](/i)')).toBe('<img src="/i" alt="a">')
    expect(h('![a](/i){.cls}')).toBe('<img src="/i" alt="a" class="cls">')
  })
})
