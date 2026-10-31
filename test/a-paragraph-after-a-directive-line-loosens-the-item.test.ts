import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const h = (s: string) => carveToHtml(s).replace(/>\s+</g, '><').trim()

// markup-carve/carve#4619, PART 10 I2 and §17 L2: a directive ends at its own
// line and opens no paragraph, so the line below it is a second paragraph and
// loosens the item.
describe('a paragraph after a directive line loosens the item', () => {
  it('writes both paragraphs of the item', () => {
    expect(h('- {{ _x_ @code:js }}\n  ^ c')).toBe('<ul><li><p>{{ _x_ @code:js }}</p><p>^ c</p></li></ul>')
    expect(h('- {{ _x_ @code:js }}\n  %% d\n  c')).toBe('<ul><li><p>{{ _x_ @code:js }}</p><p>c</p></li></ul>')
    expect(h('1. {{ x.crv @code:js }}\n   c')).toBe('<ol><li><p>{{ x.crv @code:js }}</p><p>c</p></li></ol>')
  })

  it('keeps a lone directive, a comment between paragraphs and a caption host tight', () => {
    expect(h('- {{ _x_ @code:js }}')).toBe('<ul><li>{{ _x_ @code:js }}</li></ul>')
    expect(h('- a\n  %% c\n  ^ c')).not.toContain('<p>')
    expect(h('- {%%}![a](/i)\n  ^ cap\n  ^ two')).not.toContain('<p>')
  })
})
