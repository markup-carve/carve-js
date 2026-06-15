import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const html = (s: string) => carveToHtml(s)

describe('multi-line (lazy) headings — like Djot and blockquotes', () => {
  it('folds a following non-blank line into the heading', () => {
    expect(html('# Title\noutside')).toBe(
      '<section id="title-outside">\n  <h1>Title\noutside</h1>\n</section>',
    )
  })

  it('ends the heading at a blank line', () => {
    expect(html('# H\n\ntext')).toBe(
      '<section id="h">\n  <h1>H</h1>\n  <p>text</p>\n</section>',
    )
  })

  it('a different-level heading marker starts a new heading', () => {
    expect(html('# H\n## sub')).toBe(
      '<section id="h">\n  <h1>H</h1>\n  <section id="sub">\n    <h2>sub</h2>\n  </section>\n</section>',
    )
  })

  it('a same-level # continuation line is folded with its marker stripped', () => {
    expect(html('# H\n# sib')).toBe(
      '<section id="h-sib">\n  <h1>H\nsib</h1>\n</section>',
    )
  })

  it('folds a bullet marker into the heading (no blank line)', () => {
    // A bullet no longer interrupts an open heading (§10); without a blank line
    // it folds into the multi-line heading text, like an ordered marker does.
    // A quote/table/fence/div/thematic line still ends the heading.
    expect(html('# H\n- item')).toBe(
      '<section id="h-item">\n  <h1>H\n- item</h1>\n</section>',
    )
  })

  it('a blockquote and a table also interrupt the heading', () => {
    expect(html('# H\n> q')).toBe(
      '<section id="h">\n  <h1>H</h1>\n  <blockquote><p>q</p></blockquote>\n</section>',
    )
    expect(html('# H\n| a | b |')).toBe(
      '<section id="h">\n  <h1>H</h1>\n  <table>\n    <tbody>\n      <tr><td>a</td><td>b</td></tr>\n    </tbody>\n  </table>\n</section>',
    )
  })

  it('an ordered marker does NOT interrupt (it folds, like in a paragraph)', () => {
    // §10: an ordered list never interrupts (only bullets do), so `1. one`
    // folds into the heading text just as it would into a paragraph.
    expect(html('# H\n1. one')).toBe(
      '<section id="h-1-one">\n  <h1>H\n1. one</h1>\n</section>',
    )
  })

  it('plain text still folds into the heading', () => {
    expect(html('# H\nplain words')).toBe(
      '<section id="h-plain-words">\n  <h1>H\nplain words</h1>\n</section>',
    )
  })

  it('a caption-style `^` line ends the heading rather than folding in', () => {
    expect(html('# H\n^ cap')).toBe(
      '<section id="h">\n  <h1>H</h1>\n  <p>^ cap</p>\n</section>',
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
