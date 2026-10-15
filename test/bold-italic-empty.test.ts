import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const h = (src: string) => carveToHtml(src).trim()

describe('bold-italic /*...*/ empty and space-initial rejection', () => {
  it('rejects empty content, falling back to /emphasis/ over **', () => {
    // `/**/` is not bold-italic (grammar boldItalic `~spaceOrEnd` needs an
    // inner content char). It falls through to `/` emphasis over `**`.
    expect(h('/**/')).toBe('<p><em>**</em></p>')
  })

  it('rejects space-only content', () => {
    expect(h('/* */')).toBe('<p><em>* *</em></p>')
  })

  it('rejects space-initial content', () => {
    expect(h('/* x*/')).toBe('<p><em>* x*</em></p>')
  })

  it('rejects a trailing-space closer', () => {
    expect(h('/*x */')).toBe('<p><em>*x *</em></p>')
  })

  it('keeps genuine bold-italic', () => {
    expect(h('/*x*/')).toBe('<p><strong><em>x</em></strong></p>')
  })

  it('does not open or close the combined token against a word (carve#3217)', () => {
    expect(h('x/*y*/z')).toBe('<p>x/<strong>y</strong>/z</p>')
  })
})
