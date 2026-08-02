import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const html = (s: string) => carveToHtml(s)

// PART 2, SINGLE-LINE HEADINGS (NORMATIVE, diverges from Djot). A heading ends
// at the newline: nothing folds into it, so the next line simply begins its own
// block. These cases were the folding regression guard and are kept as the
// guard for the behavior that replaced it (spec corpus 82-single-line-headings).
describe('single-line headings — a heading ends at the newline', () => {
  it('does not fold a following non-blank line into the heading', () => {
    expect(html('# Title\noutside')).toBe(
      '<section id="Title">\n  <h1>Title</h1>\n  <p>outside</p>\n</section>',
    )
  })

  it('a blank line between heading and text changes nothing', () => {
    expect(html('# H\n\ntext')).toBe(
      '<section id="H">\n  <h1>H</h1>\n  <p>text</p>\n</section>',
    )
  })

  it('a different-level heading marker starts a nested section', () => {
    expect(html('# H\n## sub')).toBe(
      '<section id="H">\n  <h1>H</h1>\n  <section id="sub">\n    <h2>sub</h2>\n  </section>\n</section>',
    )
  })

  it('a same-level # line is a SECOND heading, not a continuation', () => {
    expect(html('# H\n# sib')).toBe(
      '<section id="H">\n  <h1>H</h1>\n</section>\n<section id="sib">\n  <h1>sib</h1>\n</section>',
    )
  })

  it('a same-level ## line is a second heading too', () => {
    expect(html('## H\n## more')).toBe(
      '<section id="H">\n  <h2>H</h2>\n</section>\n<section id="more">\n  <h2>more</h2>\n</section>',
    )
  })

  it('a fewer-# marker starts a new heading at that level', () => {
    expect(html('## H\n# more')).toBe(
      '<section id="H">\n  <h2>H</h2>\n</section>\n<section id="more">\n  <h1>more</h1>\n</section>',
    )
  })

  it('a bare same-level marker line is a paragraph, not a continuation', () => {
    // `#` with no content is not a heading at all (it has no content, like the
    // caption rule), so it lands as literal text between the two headings.
    expect(html('# h\n#\n# x')).toBe(
      '<section id="h">\n  <h1>h</h1>\n  <p>#</p>\n</section>\n<section id="x">\n  <h1>x</h1>\n</section>',
    )
  })

  it('a bullet marker starts a sibling list', () => {
    expect(html('# H\n- item')).toBe(
      '<section id="H">\n  <h1>H</h1>\n  <ul>\n    <li>item</li>\n  </ul>\n</section>',
    )
  })

  it('a blockquote and a table also follow the heading as their own blocks', () => {
    expect(html('# H\n> q')).toBe(
      '<section id="H">\n  <h1>H</h1>\n  <blockquote><p>q</p></blockquote>\n</section>',
    )
    expect(html('# H\n| a | b |')).toBe(
      '<section id="H">\n  <h1>H</h1>\n  <table>\n    <tbody>\n      <tr><td>a</td><td>b</td></tr>\n    </tbody>\n  </table>\n</section>',
    )
  })

  it('an ordered marker starts a sibling list', () => {
    expect(html('# H\n1. one')).toBe(
      '<section id="H">\n  <h1>H</h1>\n  <ol>\n    <li>one</li>\n  </ol>\n</section>',
    )
  })

  it('plain text after a heading is a paragraph', () => {
    expect(html('# H\nplain words')).toBe(
      '<section id="H">\n  <h1>H</h1>\n  <p>plain words</p>\n</section>',
    )
  })

  it('a caption-style `^` line is literal text after the heading', () => {
    expect(html('# H\n^ cap')).toBe(
      '<section id="H">\n  <h1>H</h1>\n  <p>^ cap</p>\n</section>',
    )
  })

  it('the auto id comes from the heading line ALONE', () => {
    // The folding rule derived the id from heading text PLUS every folded line,
    // which silently broke cross-references and TOC anchors. Now the id is the
    // slug of exactly what is written on the heading line.
    expect(html('# Title\nSome text.')).toBe(
      '<section id="Title">\n  <h1>Title</h1>\n  <p>Some text.</p>\n</section>',
    )
  })

  it('a preceding block-attribute line applies to the heading only', () => {
    // Strict djot: heading attributes come from the PRECEDING block-attribute
    // line, not a trailing `{…}`. The following text is a separate block and
    // takes none of it.
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
  // render `<p>#</p>`.
  it('is not a heading when the remainder is whitespace only', () => {
    expect(html('#  ')).toBe('<p>#</p>')
    expect(html('#   ')).toBe('<p>#</p>')
    expect(html('#\t')).toBe('<p>#</p>')
    // A single trailing space already folds into the delimiter and leaves no
    // content, so it was never a heading.
    expect(html('# ')).toBe('<p>#</p>')
  })

  it('trailing whitespace on either line does not merge them', () => {
    expect(html('# a \nb')).toBe('<section id="a">\n  <h1>a</h1>\n  <p>b</p>\n</section>')
    expect(html('# a\nb ')).toBe('<section id="a">\n  <h1>a</h1>\n  <p>b</p>\n</section>')
  })
})
