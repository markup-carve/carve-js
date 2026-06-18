import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const html = (s: string) => carveToHtml(s)

describe('multi-line (lazy) headings — like Djot and blockquotes', () => {
  it('folds a following non-blank line into the heading', () => {
    expect(html('# Title\noutside')).toBe(
      '<section id="Title-outside">\n  <h1>Title\noutside</h1>\n</section>',
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

  it('a same-level # continuation line is folded with its marker stripped', () => {
    expect(html('# H\n# sib')).toBe(
      '<section id="H-sib">\n  <h1>H\nsib</h1>\n</section>',
    )
  })

  it('a same-level ## continuation line folds (same number of #)', () => {
    expect(html('## H\n## more')).toBe(
      '<section id="H-more">\n  <h2>H\nmore</h2>\n</section>',
    )
  })

  it('a fewer-# marker ends the heading and starts a new heading', () => {
    // Djot continuation requires EXACTLY the same number of `#`. A line with
    // fewer `#` is no longer folded; it opens a new heading at that level.
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

  it('plain text still folds into the heading', () => {
    expect(html('# H\nplain words')).toBe(
      '<section id="H-plain-words">\n  <h1>H\nplain words</h1>\n</section>',
    )
  })

  it('a caption-style `^` line ends the heading rather than folding in', () => {
    expect(html('# H\n^ cap')).toBe(
      '<section id="H">\n  <h1>H</h1>\n  <p>^ cap</p>\n</section>',
    )
  })

  it('a preceding block-attribute line applies to the whole multi-line heading', () => {
    // Strict djot: heading attributes come from the PRECEDING block-attribute
    // line, not a trailing `{…}` on the last line. The id covers the folded
    // multi-line heading.
    expect(html('{#id}\n# Title\nmore')).toBe(
      '<section id="id">\n  <h1>Title\nmore</h1>\n</section>',
    )
  })
})
