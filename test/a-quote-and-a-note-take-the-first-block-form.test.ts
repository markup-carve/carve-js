import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

// A lone `+` as the first line of a quote or a footnote takes the following
// flush-left block as the body, the same reach as `- +` and `:  +`. With no
// block below it (end of input, or a blank line) the `+` stays text.
const note = (body: string): string =>
  '<p>see<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>\n' +
  '<section role="doc-endnotes" aria-label="Footnotes">\n  <hr>\n  <ol>\n    <li id="fn1">\n' +
  body +
  '\n    </li>\n  </ol>\n</section>'
const backlink = '<a href="#fnref1" role="doc-backlink" aria-label="Back to reference">↩</a>'

describe('a block quote takes the first-block form', () => {
  it('a table joins the quote', () => {
    expect(carveToHtml('> +\n|= 2-col header | < |= header |\n')).toBe(
      '<blockquote>\n  <table>\n    <thead>\n' +
        '      <tr><th scope="col" colspan="2">2-col header</th><th scope="col">header</th></tr>\n' +
        '    </thead>\n  </table>\n</blockquote>',
    )
  })

  it('a flush paragraph is the body, without the `+`', () => {
    expect(carveToHtml('> +\nflush\n')).toBe('<blockquote><p>flush</p></blockquote>')
  })

  it('a fence joins the quote', () => {
    expect(carveToHtml('> +\n```\nx\n```\n')).toBe('<blockquote>\n  <pre><code>x\n</code></pre>\n</blockquote>')
  })

  it('a nested quote takes it from its own first line', () => {
    expect(carveToHtml('> > +\nflush\n')).toBe(
      '<blockquote>\n  <blockquote><p>flush</p></blockquote>\n</blockquote>',
    )
    expect(carveToHtml('> > +\n```\nx\n```\n')).toBe(
      '<blockquote>\n  <blockquote>\n    <pre><code>x\n</code></pre>\n  </blockquote>\n</blockquote>',
    )
  })

  it('quoted lines after the attached block continue the quote', () => {
    expect(carveToHtml('> +\npara\n> more\n')).toBe('<blockquote>\n  <p>para</p>\n  <p>more</p>\n</blockquote>')
  })

  it('a bare `+` at end of input stays the paragraph `+`', () => {
    expect(carveToHtml('> +\n')).toBe('<blockquote><p>+</p></blockquote>')
    expect(carveToHtml('> +')).toBe('<blockquote><p>+</p></blockquote>')
    expect(carveToHtml('> > +\n')).toBe('<blockquote>\n  <blockquote><p>+</p></blockquote>\n</blockquote>')
  })

  it('a bare `+` before a blank line stays the paragraph `+`', () => {
    expect(carveToHtml('> +\n\nafter\n')).toBe('<blockquote><p>+</p></blockquote>\n<p>after</p>')
    expect(carveToHtml('> > +\n\nafter\n')).toBe(
      '<blockquote>\n  <blockquote><p>+</p></blockquote>\n</blockquote>\n<p>after</p>',
    )
  })

  it('a nested quote opened after outer content takes its first block', () => {
    expect(carveToHtml('> outer\n> > +\n```\nx\n```\n')).toBe(
      '<blockquote>\n  <p>outer</p>\n  <blockquote>\n    <pre><code>x\n</code></pre>\n  </blockquote>\n</blockquote>',
    )
  })

  it('a `+` inside an already open nested quote stays text', () => {
    expect(carveToHtml('> > a\nlazy\n> > +\nz\n')).toBe(
      '<blockquote>\n  <blockquote><p>a\nlazy\n+\nz</p></blockquote>\n</blockquote>',
    )
  })

  it('a quoted line below the `+` keeps it text', () => {
    expect(carveToHtml('> +\n> x\n')).toBe('<blockquote><p>+\nx</p></blockquote>')
    expect(carveToHtml('> > +\n> > x\n')).toBe('<blockquote>\n  <blockquote><p>+\nx</p></blockquote>\n</blockquote>')
  })

  it('a further `+` below makes the first one a marker that attaches nothing', () => {
    expect(carveToHtml('> +\n+\nx\n')).toBe('<blockquote><p>x</p></blockquote>')
  })

  it('a `+` on a later quoted line is not the first-block form', () => {
    expect(carveToHtml('> a\n> +\nflush\n')).toBe('<blockquote><p>a\n+\nflush</p></blockquote>')
  })
})

describe('a footnote body takes the first-block form', () => {
  it('a fence is the note body', () => {
    expect(carveToHtml('[^a]: +\n```\nx\n```\n\nsee[^a]\n')).toBe(
      note(`      <pre><code>x\n</code></pre>\n      <p>${backlink}</p>`),
    )
  })

  it('a flush paragraph is the note body, without the `+`', () => {
    expect(carveToHtml('[^a]: +\nflush\n\nsee[^a]\n')).toBe(note(`      <p>flush${backlink}</p>`))
  })

  it('a list is the note body', () => {
    expect(carveToHtml('[^a]: +\n- x\n- y\n\nsee[^a]\n')).toBe(
      note(`      <ul>\n        <li>x</li>\n        <li>y</li>\n      </ul>\n      <p>${backlink}</p>`),
    )
  })

  it('an invisible footnote definition below is passed over, as under `- +`', () => {
    expect(carveToHtml('[^a]: +\n[^b]: n\nflush\n\nsee[^a]\n')).toBe(note(`      <p>flush${backlink}</p>`))
  })

  it('a bare `+` before a blank line stays the note text `+`', () => {
    expect(carveToHtml('[^a]: +\n\nsee[^a]\n')).toBe(note(`      <p>+${backlink}</p>`))
  })

  it('a bare `+` at end of input stays the note text `+`', () => {
    expect(carveToHtml('see[^a]\n\n[^a]: +\n')).toBe(note(`      <p>+${backlink}</p>`))
    expect(carveToHtml('see[^a]\n\n[^a]: +')).toBe(note(`      <p>+${backlink}</p>`))
  })
})
