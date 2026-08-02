import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const html = (s: string) => carveToHtml(s)

describe('single-line headings — a heading ends at the newline', () => {
  it('leaves a following non-blank line as its own paragraph', () => {
    // The id follows the heading LINE (it used to be Title-outside), which is
    // what made the old fold a silent corruption of `</#id>` and the TOC.
    expect(html('# Title\noutside')).toBe(
      '<section id="Title">\n  <h1>Title</h1>\n  <p>outside</p>\n</section>',
    )
  })

  it('ends the heading at a blank line', () => {
    expect(html('# H\n\ntext')).toBe(
      '<section id="H">\n  <h1>H</h1>\n  <p>text</p>\n</section>',
    )
  })

  it('a different-level heading marker starts a new heading', () => {
    expect(html('# H\n## sub')).toBe(
      '<section id="H">\n  <h1>H</h1>\n  <section id="sub">\n    <h2>sub</h2>\n  </section>\n</section>',
    )
  })

  it('a same-level # line is simply the next heading', () => {
    // Djot's explicit continuation form. It no longer continues anything.
    expect(html('# H\n# sib')).toBe(
      '<section id="H">\n  <h1>H</h1>\n</section>\n<section id="sib">\n  <h1>sib</h1>\n</section>',
    )
  })

  it('a same-level ## line is simply the next heading', () => {
    expect(html('## H\n## more')).toBe(
      '<section id="H">\n  <h2>H</h2>\n</section>\n<section id="more">\n  <h2>more</h2>\n</section>',
    )
  })

  it('a fewer-# marker starts a new heading', () => {
    // This one never folded, and now every `#` line answers the same way.
    expect(html('## H\n# more')).toBe(
      '<section id="H">\n  <h2>H</h2>\n</section>\n<section id="more">\n  <h1>more</h1>\n</section>',
    )
  })

  it('a bullet marker ends the heading and starts a sibling list', () => {
    // A bullet does not fold into an open heading; it ends the heading and
    // opens a sibling list inside the section (Option D, matches djot).
    expect(html('# H\n- item')).toBe(
      '<section id="H">\n  <h1>H</h1>\n  <ul>\n    <li>item</li>\n  </ul>\n</section>',
    )
  })

  it('a blockquote and a table also interrupt the heading', () => {
    expect(html('# H\n> q')).toBe(
      '<section id="H">\n  <h1>H</h1>\n  <blockquote><p>q</p></blockquote>\n</section>',
    )
    expect(html('# H\n| a | b |')).toBe(
      '<section id="H">\n  <h1>H</h1>\n  <table>\n    <tbody>\n      <tr><td>a</td><td>b</td></tr>\n    </tbody>\n  </table>\n</section>',
    )
  })

  it('an ordered marker ends the heading and starts a sibling list', () => {
    // A list marker ends an open heading and opens a sibling list inside the
    // section, ordered behaving the same as bullet (Option D, matches djot).
    expect(html('# H\n1. one')).toBe(
      '<section id="H">\n  <h1>H</h1>\n  <ol>\n    <li>one</li>\n  </ol>\n</section>',
    )
  })

  it('plain text after a heading is a paragraph', () => {
    expect(html('# H\nplain words')).toBe(
      '<section id="H">\n  <h1>H</h1>\n  <p>plain words</p>\n</section>',
    )
  })

  it('a caption-style `^` line ends the heading rather than folding in', () => {
    expect(html('# H\n^ cap')).toBe(
      '<section id="H">\n  <h1>H</h1>\n  <p>^ cap</p>\n</section>',
    )
  })

  it('a preceding block-attribute line applies to the heading alone', () => {
    // Strict djot: heading attributes come from the PRECEDING block-attribute
    // line, not a trailing `{…}` on the heading line. It reaches the heading,
    // not the paragraph beneath it.
    expect(html('{#id}\n# Title\nmore')).toBe(
      '<section id="id">\n  <h1>Title</h1>\n  <p>more</p>\n</section>',
    )
  })

  // §756 (NORMATIVE): the heading line's trailing whitespace is stripped. A
  // leading TAB after the delimiter is content (kept), unlike leading spaces
  // which fold into the delimiter.
  it('strips the heading line trailing whitespace', () => {
    expect(html('# x ')).toBe('<section id="x">\n  <h1>x</h1>\n</section>')
  })

  it('keeps a leading tab as content (only spaces fold into the delimiter)', () => {
    expect(html('# \tx')).toBe('<section id="x">\n  <h1>\tx</h1>\n</section>')
  })

  // A marker followed by whitespace ONLY is not a heading (it has no content),
  // exactly like the caption rule. Matches carve-rs / carve-php, which both
  // render `<p>#</p>`; previously two-or-more trailing spaces slipped through as
  // an empty `<h1 id="s">`.
  it('is not a heading when the remainder is whitespace only', () => {
    expect(html('#  ')).toBe('<p>#</p>')
    expect(html('#   ')).toBe('<p>#</p>')
    expect(html('#\t')).toBe('<p>#</p>')
    // A single trailing space already folds into the delimiter and leaves no
    // content, so it was never a heading.
    expect(html('# ')).toBe('<p>#</p>')
  })

  it('strips trailing whitespace on the heading and on the line beneath', () => {
    const expected = '<section id="a">\n  <h1>a</h1>\n  <p>b</p>\n</section>'
    expect(html('# a \nb')).toBe(expected)
    expect(html('# a\nb ')).toBe(expected)
  })
})
