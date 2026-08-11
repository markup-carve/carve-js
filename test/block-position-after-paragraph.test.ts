import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/* PART 9 §10: every block kind needs block position after an open paragraph. */
describe('top-level block position after a paragraph (§10)', () => {
  it('a `* ` unordered marker folds into prose (no blank line)', () => {
    const html = carveToHtml("Die Frage ist x = 5\n* 3 + 17 wahr.\n")
    expect(html).toBe('<p>Die Frage ist x = 5\n* 3 + 17 wahr.</p>')
  })

  it('two same-kind bullets after prose fold into the paragraph (no blank line)', () => {
    const html = carveToHtml("Liste:\n- eins\n- zwei\n")
    expect(html).toBe('<p>Liste:\n- eins\n- zwei</p>')
  })

  it('a bullet line and its indented continuation both fold into prose', () => {
    const html = carveToHtml("Shopping:\n- milk and\nsome bread\n")
    expect(html).toBe('<p>Shopping:\n- milk and\nsome bread</p>')
  })

  it('a blank establishes block position for a quote', () => {
    const html = carveToHtml("They said:\n\n> one\n> two\n")
    expect(html).toBe(
      '<p>They said:</p>\n<blockquote><p>one\ntwo</p></blockquote>',
    )
  })

  it('a blank establishes block position for a heading', () => {
    const html = carveToHtml("Some text\n\n# Heading\n")
    expect(html).toBe(
      '<p>Some text</p>\n<section id="Heading">\n  <h1>Heading</h1>\n</section>',
    )
  })

  it('an ordered-list marker does not interrupt prose (needs a blank line)', () => {
    const html = carveToHtml("Steps\n1. first\n")
    expect(html).toBe('<p>Steps\n1. first</p>')
  })

  it('a captioned quote starts in block position', () => {
    const html = carveToHtml("Intro\n\n> Stay hungry\n^ Steve Jobs\n")
    expect(html).toBe(
      '<p>Intro</p>\n<figure>\n  <blockquote><p>Stay hungry</p></blockquote>\n  <figcaption>Steve Jobs</figcaption>\n</figure>',
    )
  })

  it('a captioned table starts in block position', () => {
    const html = carveToHtml("Intro\n\n|=A|\n^ caption\n")
    expect(html).toBe(
      '<p>Intro</p>\n<table>\n  <caption>caption</caption>\n  <thead><tr><th>A</th></tr></thead>\n</table>',
    )
  })

  it('a generic div starts in block position', () => {
    expect(carveToHtml("text\n\n:::\ncontent\n:::\n")).toBe(
      '<p>text</p>\n<div>\n  <p>content</p>\n</div>',
    )
  })

  it('a ::: | line block starts in block position', () => {
    expect(carveToHtml("intro\n\n::: |\nverse\n:::\n")).toBe(
      '<p>intro</p>\n<div class="line-block">\n  <p>verse</p>\n</div>',
    )
  })
})

describe('a blank line starts the block (§10)', () => {
  it('blank line then bullets is a list', () => {
    const html = carveToHtml("Text hier\n\n- eins\n- zwei\n")
    expect(html).toContain('<ul>')
    expect(html).toContain('<li>eins</li>')
  })

  it('blank line then a single bullet is a list', () => {
    const html = carveToHtml("Text hier\n\n- nur eins\n")
    expect(html).toContain('<ul>')
  })

  it('blank line then heading is a heading', () => {
    const html = carveToHtml("Some text\n\n# Heading\n")
    expect(html).toContain('<h1')
  })

  it('blank line then quote is a blockquote', () => {
    const html = carveToHtml("They said:\n\n> one\n> two\n")
    expect(html).toContain('<blockquote>')
  })
})

describe('non-rendering constructs also require block position', () => {
  it('a footnote definition right after prose resolves (no blank line)', () => {
    const html = carveToHtml("See[^n].\n\n[^n]: the note\n")
    expect(html).toContain('role="doc-noteref"')
    expect(html).toContain('role="doc-endnotes"')
    expect(html).not.toContain('[^n]: the note')
  })

  it('a link definition right after prose resolves (no blank line)', () => {
    expect(carveToHtml("See [x][r].\n\n[r]: /u\n").trim()).toBe(
      '<p>See <a href="/u">x</a>.</p>',
    )
  })

  it('an abbreviation definition right after prose is collected (no blank line)', () => {
    expect(carveToHtml("Uses HTML.\n\n*[HTML]: HyperText\n").trim()).toBe(
      '<p>Uses <abbr title="HyperText">HTML</abbr>.</p>',
    )
  })

  it('a line comment right after prose is stripped (no blank line)', () => {
    expect(carveToHtml("para\n\n%% hidden\n").trim()).toBe('<p>para</p>')
  })

  it('a block comment right after prose is stripped (no blank line)', () => {
    expect(carveToHtml("para\n\n%%%\nsecret\n%%%\n").trim()).toBe('<p>para</p>')
  })
})

describe('nested content uses the same block-position rule', () => {
  it('single nested child still nests', () => {
    const html = carveToHtml("- parent\n  - child\n")
    expect(html).toContain('<ul>')
    expect(html).toContain('<li>child</li>')
  })

  it('single bullet inside a blockquote folds (no interrupt)', () => {
    // A bullet no longer interrupts the open quote paragraph; without a blank
    // line it folds into the quote text rather than opening a list.
    const html = carveToHtml("> intro\n> - child\n")
    expect(html).toBe('<blockquote><p>intro\n- child</p></blockquote>')
  })

  it('lead text + single nested child in one item', () => {
    const html = carveToHtml("- parent text\n  - child\n")
    expect(html).toContain('<li>child</li>')
  })

  it('a continuation marker establishes block position for a heading', () => {
    const html = carveToHtml("- text\n+\n# H\n")
    // A heading inside a list item carries its slug id on the <h*> (carve-php
    // parity); no <section> wrapper is emitted inside an item.
    expect(html).toBe('<ul>\n  <li>text\n    <h1 id="H">H</h1>\n  </li>\n</ul>')
  })

  it('a continuation marker establishes block position for a div', () => {
    const html = carveToHtml("- item\n+\n:::\ncontent\n:::\n")
    expect(html).toBe(
      '<ul>\n  <li>item\n    <div>\n      <p>content</p>\n    </div>\n  </li>\n</ul>',
    )
  })

  it('a blank line lets a generic div nest', () => {
    const html = carveToHtml("- item\n+\n:::\ncontent\n:::\n")
    expect(html).toContain('<div>')
  })

  it('an unclosed nested div opens and auto-closes without hanging', () => {
    const html = carveToHtml("- item\n+\n:::\ncontent\n:::\n")
    expect(html).toBe(
      '<ul>\n  <li>item\n    <div>\n      <p>content</p>\n    </div>\n  </li>\n</ul>',
    )
  })
})

describe('uniform paragraph extent and nested coverage', () => {
  it('an unterminated fence shape stays in the paragraph', () => {
    // The unclosed run is inline verbatim to the end of the paragraph.
    expect(carveToHtml("text\n`\nno closer`\n")).toBe(
      '<p>text\n<code>\nno closer</code></p>',
    )
  })

  it('a glued admonition word remains paragraph text', () => {
    expect(carveToHtml("text\n:::note\nno closer\n")).toBe(
      '<p>text\n:::note\nno closer</p>',
    )
  })

  it('every ordered-list marker needs block position', () => {
    expect(carveToHtml("p\n1. a\n")).toBe('<p>p\n1. a</p>')
    expect(carveToHtml("p\n2. a\n")).toBe('<p>p\n2. a</p>')
    expect(carveToHtml("p\n1985. a\n")).toBe('<p>p\n1985. a</p>')
  })

  it('a bare image line remains inline in the paragraph', () => {
    expect(carveToHtml("p\n![a](u)\n")).toBe('<p>p\n<img src="u" alt="a"></p>')
  })

  it('heading, blockquote, and table start after a blank at top level', () => {
    expect(carveToHtml("p\n\n# H\n")).toBe(
      '<p>p</p>\n<section id="H">\n  <h1>H</h1>\n</section>',
    )
    // A bullet no longer interrupts: it folds into the paragraph (no blank line).
    expect(carveToHtml("p\n- a\n")).toBe('<p>p\n- a</p>')
    expect(carveToHtml("p\n\n> q\n")).toBe('<p>p</p>\n<blockquote><p>q</p></blockquote>')
    expect(carveToHtml("p\n\n| a |\n")).toBe(
      '<p>p</p>\n<table>\n  <tbody>\n    <tr><td>a</td></tr>\n  </tbody>\n</table>',
    )
  })

  it('heading, blockquote, and table start after a quoted blank', () => {
    expect(carveToHtml("> p\n>\n> # H\n")).toBe(
      '<blockquote>\n  <p>p</p>\n  <h1 id="H">H</h1>\n</blockquote>',
    )
    // A bullet no longer interrupts: it folds into the quote paragraph.
    expect(carveToHtml("> p\n> - a\n")).toBe('<blockquote><p>p\n- a</p></blockquote>')
    expect(carveToHtml("> p\n>\n> > q\n")).toBe(
      '<blockquote>\n  <p>p</p>\n  <blockquote><p>q</p></blockquote>\n</blockquote>',
    )
    expect(carveToHtml("> p\n>\n> | a |\n")).toBe(
      '<blockquote>\n  <p>p</p>\n  <table>\n    <tbody>\n      <tr><td>a</td></tr>\n    </tbody>\n  </table>\n</blockquote>',
    )
  })
})

describe('block openers below the content column fold as lazy text under a list item', () => {
  const h = (s: string) => carveToHtml(s).trim()

  // Content-column model (carve#295): a block opener is recognized only AT the
  // item's content column - the item body's column 0 - exactly as a block
  // opener is recognized only at column 0 at the top level. Below the content
  // column the marker carries residual indent, so it is not a block opener; it
  // folds into the item's lead paragraph as lazy text (like ` # h` at the top
  // level). This is an intentional divergence from djot / the old carve-php
  // reading, which nested it.

  it('folds a block quote indented below an ordered item content column', () => {
    // `> q` at column 2 is below the `1. ` content column (3), so it folds.
    expect(h('1. a\n  > q')).toBe('<ol>\n  <li>a\n&gt; q</li>\n</ol>')
  })

  it('folds a one-space-indented block quote under an ordered item', () => {
    expect(h('1. a\n > q')).toBe('<ol>\n  <li>a\n&gt; q</li>\n</ol>')
  })

  it('folds a heading below the content column', () => {
    expect(h('1. a\n  # H')).toBe('<ol>\n  <li>a\n# H</li>\n</ol>')
  })

  it('folds a multi-line block quote below the content column', () => {
    expect(h('1. a\n  > q1\n  > q2')).toBe('<ol>\n  <li>a\n&gt; q1\n&gt; q2</li>\n</ol>')
  })

  it('still folds an ordered marker below the content column (no interrupt)', () => {
    expect(h('1. a\n  1. b')).toBe('<ol>\n  <li>a\n1. b</li>\n</ol>')
  })
})
