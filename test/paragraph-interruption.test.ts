import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * Markdown-like paragraph interruption (grammar PART 9 §10): visible block
 * starts interrupt an open paragraph without a blank line, at top level and
 * inside nested content. List markers (bullet, task, AND ordered) do NOT
 * interrupt -- they need a blank line, so without one they fold into the open
 * paragraph as lazy continuation; fenced code or div/admonition openers only
 * interrupt when a closer exists.
 */
describe('top-level paragraph interruption (§10)', () => {
  it('a `* ` unordered marker folds into prose (no blank line)', () => {
    const html = carveToHtml('Die Frage ist x = 5\n* 3 + 17 wahr.')
    expect(html).toBe('<p>Die Frage ist x = 5\n* 3 + 17 wahr.</p>')
  })

  it('two same-kind bullets after prose fold into the paragraph (no blank line)', () => {
    const html = carveToHtml('Liste:\n- eins\n- zwei')
    expect(html).toBe('<p>Liste:\n- eins\n- zwei</p>')
  })

  it('a bullet line and its indented continuation both fold into prose', () => {
    const html = carveToHtml('Shopping:\n- milk and\n  some bread')
    expect(html).toBe('<p>Shopping:\n- milk and\nsome bread</p>')
  })

  it('two blockquote lines after prose interrupt as a quote', () => {
    const html = carveToHtml('They said:\n> one\n> two')
    expect(html).toBe(
      '<p>They said:</p>\n<blockquote><p>one\ntwo</p></blockquote>',
    )
  })

  it('a heading after prose interrupts', () => {
    const html = carveToHtml('Some text\n# Heading')
    expect(html).toBe(
      '<p>Some text</p>\n<section id="heading">\n  <h1>Heading</h1>\n</section>',
    )
  })

  it('an ordered-list marker does not interrupt prose (needs a blank line)', () => {
    const html = carveToHtml('Steps\n1. first')
    expect(html).toBe('<p>Steps\n1. first</p>')
  })

  it('a captioned one-line quote after prose interrupts', () => {
    const html = carveToHtml('Intro\n> Stay hungry\n^ Steve Jobs')
    expect(html).toBe(
      '<p>Intro</p>\n<figure>\n  <blockquote><p>Stay hungry</p></blockquote>\n  <figcaption>Steve Jobs</figcaption>\n</figure>',
    )
  })

  it('a captioned one-row table after prose interrupts', () => {
    const html = carveToHtml('Intro\n|= A |\n^ caption')
    expect(html).toBe(
      '<p>Intro</p>\n<table>\n  <caption>caption</caption>\n  <thead><tr><th>A</th></tr></thead>\n</table>',
    )
  })

  it('a closed generic div after prose interrupts', () => {
    expect(carveToHtml('text\n:::\ncontent\n:::')).toBe(
      '<p>text</p>\n<div>\n  <p>content</p>\n</div>',
    )
  })

  it('a closed ::: | line block after prose interrupts', () => {
    // The pipe opener shares the bare `:::` closer, so it interrupts a
    // paragraph (with a closer ahead) just like a generic div does.
    expect(carveToHtml('intro\n::: |\nverse\n:::')).toBe(
      '<p>intro</p>\n<div class="line-block">\n  <p>verse</p>\n</div>',
    )
  })
})

describe('a blank line starts the block (§10)', () => {
  it('blank line then bullets is a list', () => {
    const html = carveToHtml('Text hier\n\n- eins\n- zwei')
    expect(html).toContain('<ul>')
    expect(html).toContain('<li>eins</li>')
  })

  it('blank line then a single bullet is a list', () => {
    const html = carveToHtml('Text hier\n\n- nur eins')
    expect(html).toContain('<ul>')
  })

  it('blank line then heading is a heading', () => {
    const html = carveToHtml('Some text\n\n# Heading')
    expect(html).toContain('<h1')
  })

  it('blank line then quote is a blockquote', () => {
    const html = carveToHtml('They said:\n\n> one\n> two')
    expect(html).toContain('<blockquote>')
  })
})

// Invisible constructs — reference definitions and comments — are not rendered
// blocks, so unlike a visible block they still interrupt a paragraph with no
// blank line, rather than being folded into it as literal text.
describe('invisible constructs still interrupt (§10 carve-out)', () => {
  it('a footnote definition right after prose resolves (no blank line)', () => {
    const html = carveToHtml('See[^n].\n[^n]: the note')
    expect(html).toContain('role="doc-noteref"')
    expect(html).toContain('role="doc-endnotes"')
    expect(html).not.toContain('[^n]: the note')
  })

  it('a link definition right after prose resolves (no blank line)', () => {
    expect(carveToHtml('See [x][r].\n[r]: /u').trim()).toBe(
      '<p>See <a href="/u">x</a>.</p>',
    )
  })

  it('an abbreviation definition right after prose is collected (no blank line)', () => {
    expect(carveToHtml('Uses HTML.\n*[HTML]: HyperText').trim()).toBe(
      '<p>Uses <abbr title="HyperText">HTML</abbr>.</p>',
    )
  })

  it('a line comment right after prose is stripped (no blank line)', () => {
    expect(carveToHtml('para\n%% hidden').trim()).toBe('<p>para</p>')
  })

  it('a block comment right after prose is stripped (no blank line)', () => {
    expect(carveToHtml('para\n%%%\nsecret\n%%%').trim()).toBe('<p>para</p>')
  })
})

// Inside already-nested content, visible block starts also interrupt an open
// paragraph. List markers still provide the sublist behavior expected from
// indentation alone.
describe('nested content: visible block starts interrupt paragraphs', () => {
  it('single nested child still nests', () => {
    const html = carveToHtml('- parent\n  - child')
    expect(html).toContain('<ul>')
    expect(html).toContain('<li>child</li>')
  })

  it('single bullet inside a blockquote folds (no interrupt)', () => {
    // A bullet no longer interrupts the open quote paragraph; without a blank
    // line it folds into the quote text rather than opening a list.
    const html = carveToHtml('> intro\n> - child')
    expect(html).toBe('<blockquote><p>intro\n- child</p></blockquote>')
  })

  it('lead text + single nested child in one item', () => {
    const html = carveToHtml('- parent text\n  - child')
    expect(html).toContain('<li>child</li>')
  })

  it('a heading after lead text in an item interrupts', () => {
    const html = carveToHtml('- text\n  # H')
    // A heading inside a list item carries its slug id on the <h*> (carve-php
    // parity); no <section> wrapper is emitted inside an item.
    expect(html).toBe('<ul>\n  <li>text\n    <h1 id="h">H</h1>\n  </li>\n</ul>')
  })

  it('a closed generic div without a blank line interrupts', () => {
    const html = carveToHtml('- item\n  :::\n  content\n  :::')
    expect(html).toBe(
      '<ul>\n  <li>item\n    <div>\n      <p>content</p>\n    </div>\n  </li>\n</ul>',
    )
  })

  it('a blank line lets a generic div nest', () => {
    const html = carveToHtml('- item\n\n  :::\n  content\n  :::')
    expect(html).toContain('<div>')
  })

  it('an unclosed nested div stays literal (no hang)', () => {
    const html = carveToHtml('- item\n  :::\n  content')
    expect(html).not.toContain('<div>')
  })
})

describe('paragraph interruption carve-outs and nested coverage', () => {
  it('an unterminated fence does not interrupt (stays in the paragraph)', () => {
    // No matching closer ahead, so the fence does not interrupt (§10 closer
    // lookahead); the unclosed run is then an inline verbatim span to end of
    // block (the inline-verbatim rule), not a code block.
    expect(carveToHtml('text\n```\nno closer')).toBe(
      '<p>text\n<code>\nno closer</code></p>',
    )
  })

  it('an unterminated div/admonition remains paragraph text', () => {
    expect(carveToHtml('text\n:::note\nno closer')).toBe(
      '<p>text\n:::note\nno closer</p>',
    )
  })

  it('no ordered-list marker interrupts a paragraph (needs a blank line)', () => {
    expect(carveToHtml('p\n1. a')).toBe('<p>p\n1. a</p>')
    expect(carveToHtml('p\n2. a')).toBe('<p>p\n2. a</p>')
    expect(carveToHtml('p\n1985. a')).toBe('<p>p\n1985. a</p>')
  })

  it('a bare image line remains inline in the paragraph', () => {
    expect(carveToHtml('p\n![a](u)')).toBe('<p>p\n<img src="u" alt="a"></p>')
  })

  it('heading, blockquote, and table interrupt at top level (a list folds)', () => {
    expect(carveToHtml('p\n# H')).toBe(
      '<p>p</p>\n<section id="h">\n  <h1>H</h1>\n</section>',
    )
    // A bullet no longer interrupts: it folds into the paragraph (no blank line).
    expect(carveToHtml('p\n- a')).toBe('<p>p\n- a</p>')
    expect(carveToHtml('p\n> q')).toBe('<p>p</p>\n<blockquote><p>q</p></blockquote>')
    expect(carveToHtml('p\n| a |')).toBe(
      '<p>p</p>\n<table>\n  <tbody>\n    <tr><td>a</td></tr>\n  </tbody>\n</table>',
    )
  })

  it('heading, blockquote, and table interrupt inside a quote (a list folds)', () => {
    expect(carveToHtml('> p\n> # H')).toBe(
      '<blockquote>\n  <p>p</p>\n  <h1 id="h">H</h1>\n</blockquote>',
    )
    // A bullet no longer interrupts: it folds into the quote paragraph.
    expect(carveToHtml('> p\n> - a')).toBe('<blockquote><p>p\n- a</p></blockquote>')
    expect(carveToHtml('> p\n> > q')).toBe(
      '<blockquote>\n  <p>p</p>\n  <blockquote><p>q</p></blockquote>\n</blockquote>',
    )
    expect(carveToHtml('> p\n> | a |')).toBe(
      '<blockquote>\n  <p>p</p>\n  <table>\n    <tbody>\n      <tr><td>a</td></tr>\n    </tbody>\n  </table>\n</blockquote>',
    )
  })
})

describe('block openers below the content column nest under a list item', () => {
  const h = (s: string) => carveToHtml(s).trim()

  it('nests a block quote indented below an ordered item content column', () => {
    // `> q` at column 2 is below the `1. ` content column (3) but past the base,
    // so it interrupts the item paragraph and nests (matches carve-php); only
    // ordered MARKERS fold below the content column.
    expect(h('1. a\n  > q')).toBe(
      '<ol>\n  <li>a\n    <blockquote><p>q</p></blockquote>\n  </li>\n</ol>',
    )
  })

  it('nests a one-space-indented block quote under an ordered item', () => {
    expect(h('1. a\n > q')).toBe(
      '<ol>\n  <li>a\n    <blockquote><p>q</p></blockquote>\n  </li>\n</ol>',
    )
  })

  it('nests a heading below the content column', () => {
    expect(h('1. a\n  # H')).toBe('<ol>\n  <li>a\n    <h1 id="h">H</h1>\n  </li>\n</ol>')
  })

  it('nests a multi-line block quote below the content column', () => {
    expect(h('1. a\n  > q1\n  > q2')).toBe(
      '<ol>\n  <li>a\n    <blockquote><p>q1\nq2</p></blockquote>\n  </li>\n</ol>',
    )
  })

  it('still folds an ordered marker below the content column (no interrupt)', () => {
    expect(h('1. a\n  1. b')).toBe('<ol>\n  <li>a\n1. b</li>\n</ol>')
  })
})
