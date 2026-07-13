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

// A leading block-attribute line (`{#id}`) before a sole block image lands on
// the promoted bare `<img>` (§15) -- consistent with an inline `![…](…){#id}`
// and with the fact that a sole image renders bare (no `<p>` wrapper). It does
// NOT wrap the image in a `<p>`.
describe('a leading attribute line attaches to a bare block image', () => {
  it('direct image', () => {
    expect(h('{#f}\n![a](/u)')).toBe('<img src="/u" alt="a" id="f">')
  })

  it('resolved reference image', () => {
    expect(h('{#f}\n![a][r]\n\n[r]: /u')).toBe('<img src="/u" alt="a" id="f">')
  })

  it('merges with the image’s own inline attributes (§15 order)', () => {
    expect(h('{#f}\n![a][r]{.c}\n\n[r]: /u')).toBe(
      '<img src="/u" alt="a" id="f" class="c">',
    )
  })

  it('a following caption still puts the id on the <figure>, not the <img>', () => {
    expect(h('{#f}\n![a](/u)\n^ cap')).toBe(
      '<figure id="f">\n  <img src="/u" alt="a">\n  <figcaption>cap</figcaption>\n</figure>',
    )
  })

  it('two images stay a paragraph (attr on the <p>)', () => {
    expect(h('{#f}\n![a](/u)\n![b](/u)')).toBe(
      '<p id="f"><img src="/u" alt="a">\n<img src="/u" alt="b"></p>',
    )
  })
})

// The caption delimiter mirrors a heading's first line (§4/§553): `^` + one-or-
// more literal SPACES (not a tab) + non-empty content. `^ ` alone, `^\t…`, or a
// `^ ` whose content only appears on a later folded line is NOT a caption, just
// as `# ` / `#\t…` is not a heading.
describe('caption whitespace mirrors the heading delimiter', () => {
  it('an empty caption (`^ ` alone) is not a caption', () => {
    expect(h('![a](/u)\n^ ')).toBe('<p><img src="/u" alt="a">\n^</p>')
  })

  it('`^ ` with content only on a later line is not a caption', () => {
    expect(h('![a](/u)\n^ \nmore')).toBe(
      '<p><img src="/u" alt="a">\n^ \nmore</p>',
    )
  })

  it('a tab after `^` is not a caption delimiter', () => {
    expect(h('![a](/u)\n^\tx')).toBe('<p><img src="/u" alt="a">\n^\tx</p>')
  })

  it('extra leading spaces after `^ ` are folded into the delimiter', () => {
    expect(h('![a](/u)\n^  x')).toBe(
      '<figure>\n  <img src="/u" alt="a">\n  <figcaption>x</figcaption>\n</figure>',
    )
  })

  it('a reference-image empty caption is not promoted to a figure', () => {
    expect(h('![a][r]\n^ \n\n[r]: /u')).toBe('<p><img src="/u" alt="a">\n^</p>')
  })

  it('a reference-image caption whose content is inline markup is a figure', () => {
    expect(h('![a][r]\n^ *b* c\n\n[r]: /u')).toBe(
      '<figure>\n  <img src="/u" alt="a">\n  <figcaption><strong>b</strong> c</figcaption>\n</figure>',
    )
  })

  // A non-breaking space is content everywhere else in the parser, so `^  `
  // IS a caption -- "content" excludes only ASCII whitespace, not NBSP.
  it('a non-breaking space is caption content', () => {
    expect(h('![a](/u)\n^ \u00a0')).toBe(
      '<figure>\n  <img src="/u" alt="a">\n  <figcaption>&nbsp;</figcaption>\n</figure>',
    )
  })

  // \u00a7756: a caption strips its final line's trailing whitespace and keeps a
  // leading tab as content, exactly like a heading first line.
  it('strips caption trailing whitespace, keeps a leading tab', () => {
    expect(h('![a](/u)\n^ x ')).toBe(
      '<figure>\n  <img src="/u" alt="a">\n  <figcaption>x</figcaption>\n</figure>',
    )
    expect(h('![a](/u)\n^ \tx')).toBe(
      '<figure>\n  <img src="/u" alt="a">\n  <figcaption>\tx</figcaption>\n</figure>',
    )
  })
})
