import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const h = (s: string) => carveToHtml(s)

describe('multi-line captions (paragraph continuation model)', () => {
  it('folds a following plain line into the caption', () => {
    expect(h('![a](/u)\n^ cap\nmore')).toBe(
      '<figure>\n  <img src="/u" alt="a">\n  <figcaption>cap\nmore</figcaption>\n</figure>',
    )
  })

  it('a blank line ends the caption', () => {
    expect(h('![a](/u)\n^ cap\n\nmore')).toBe(
      '<figure>\n  <img src="/u" alt="a">\n  <figcaption>cap</figcaption>\n</figure>\n<p>more</p>',
    )
  })

  it('a list marker FOLDS in (a list needs a blank line to interrupt)', () => {
    expect(h('![a](/u)\n^ cap\n- x')).toBe(
      '<figure>\n  <img src="/u" alt="a">\n  <figcaption>cap\n- x</figcaption>\n</figure>',
    )
  })

  it('a heading ends the caption', () => {
    expect(h('![a](/u)\n^ cap\n# H')).toBe(
      '<figure>\n  <img src="/u" alt="a">\n  <figcaption>cap</figcaption>\n</figure>\n' +
        '<section id="H">\n  <h1>H</h1>\n</section>',
    )
  })

  it('a blockquote ends the caption', () => {
    expect(h('![a](/u)\n^ cap\n> q')).toBe(
      '<figure>\n  <img src="/u" alt="a">\n  <figcaption>cap</figcaption>\n</figure>\n' +
        '<blockquote><p>q</p></blockquote>',
    )
  })

  it('a further ^ line ends the caption', () => {
    expect(h('![a](/u)\n^ cap\n^ two')).toBe(
      '<figure>\n  <img src="/u" alt="a">\n  <figcaption>cap</figcaption>\n</figure>\n<p>^ two</p>',
    )
  })

  it('applies to a code-block listing caption', () => {
    expect(h('```\nx\n```\n^ cap\nmore')).toBe(
      '<figure>\n  <pre><code>x\n</code></pre>\n  <figcaption>cap\nmore</figcaption>\n</figure>',
    )
  })

  it('applies to a reference image + multi-line caption', () => {
    expect(h('![a][r]\n^ cap\nmore\n\n[r]: /u')).toBe(
      '<figure>\n  <img src="/u" alt="a">\n  <figcaption>cap\nmore</figcaption>\n</figure>',
    )
  })
})
