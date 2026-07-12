import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const h = (s: string) => carveToHtml(s)

// Grammar §1722 I3: a bare image is not a block of its own; it stays an inline
// image inside a paragraph. It renders as a bare block image only when it
// stands ALONE (or carries a caption).
describe('a bare image followed by folding content stays in a paragraph', () => {
  it('image + plain text is one paragraph', () => {
    expect(h('![a](/u)\nmore')).toBe('<p><img src="/u" alt="a">\nmore</p>')
  })

  it('two bare images on adjacent lines are one paragraph', () => {
    expect(h('![a](/u)\n![b](/u)')).toBe(
      '<p><img src="/u" alt="a">\n<img src="/u" alt="b"></p>',
    )
  })

  it('image + a list marker folds (a list needs a blank line)', () => {
    expect(h('![a](/u)\n- x')).toBe('<p><img src="/u" alt="a">\n- x</p>')
  })

  it('image ALONE is a bare block image', () => {
    expect(h('![a](/u)')).toBe('<img src="/u" alt="a">')
  })

  it('image + blank line + text keeps the image standalone', () => {
    expect(h('![a](/u)\n\nmore')).toBe('<img src="/u" alt="a">\n<p>more</p>')
  })

  it('image + caption is a figure', () => {
    expect(h('![a](/u)\n^ cap')).toBe(
      '<figure>\n  <img src="/u" alt="a">\n  <figcaption>cap</figcaption>\n</figure>',
    )
  })

  it('image + an interrupting heading keeps the image standalone', () => {
    expect(h('![a](/u)\n# H')).toBe(
      '<img src="/u" alt="a">\n<section id="H">\n  <h1>H</h1>\n</section>',
    )
  })
})
