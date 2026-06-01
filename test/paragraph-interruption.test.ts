import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * Full-djot paragraph interruption (grammar PART 9 §10): at the document top
 * level ONLY a blank line ends a paragraph. A block-start marker on a
 * continuation line — a bullet/quote/table marker, a heading, a fence, a
 * thematic break, an admonition, even a decimal list — is paragraph text, so a
 * hard-wrapped prose line never silently becomes a block. The one scoping
 * carve-out: inside already-nested content (Lexer.nested) a marker still
 * interrupts, so `- a\n  - b` keeps nesting a sublist.
 */
describe('top-level paragraph: only a blank line interrupts (§10, full djot)', () => {
  it('multiplication "* 3" stays prose', () => {
    const html = carveToHtml('Die Frage ist x = 5\n* 3 + 17 wahr.\nim Text.')
    expect(html).not.toContain('<ul>')
  })

  it('two same-kind bullets after prose stay prose (need a blank line)', () => {
    const html = carveToHtml('Liste:\n- eins\n- zwei')
    expect(html).not.toContain('<ul>')
    expect(html).toContain('<p>')
  })

  it('an indented continuation after prose stays prose', () => {
    const html = carveToHtml('Shopping:\n- milk and\n  some bread')
    expect(html).not.toContain('<ul>')
  })

  it('two blockquote lines after prose stay prose', () => {
    const html = carveToHtml('They said:\n> one\n> two')
    expect(html).not.toContain('<blockquote>')
  })

  it('a heading after prose stays prose (no blank line)', () => {
    const html = carveToHtml('Some text\n# Heading')
    expect(html).not.toContain('<h1')
  })

  it('a decimal list after prose stays prose (no blank line)', () => {
    const html = carveToHtml('Steps\n1. first')
    expect(html).not.toContain('<ol>')
  })

  it('a captioned one-line quote after prose stays prose', () => {
    const html = carveToHtml('Intro\n> Stay hungry\n^ Steve Jobs')
    expect(html).not.toContain('<figure>')
    expect(html).not.toContain('<blockquote>')
  })

  it('a captioned one-row table after prose stays prose', () => {
    const html = carveToHtml('Intro\n|= A |\n^ caption')
    expect(html).not.toContain('<table')
  })

  it('a generic div after prose stays prose (no blank line)', () => {
    expect(carveToHtml('text\n:::\ncontent\n:::')).not.toContain('<div>')
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

// Inside already-nested content, ONLY a list marker interrupts without a
// blank line (the single Carve deviation: `- a\n  - b` nests a sublist).
// Every other block opener — heading, fence, div, etc. — does NOT interrupt
// nested either; it needs a blank line, matching djot (grammar §10 SCOPING).
describe('nested content: only a list marker interrupts (sublists keep nesting)', () => {
  it('single nested child still nests', () => {
    const html = carveToHtml('- parent\n  - child')
    expect(html).toContain('<ul>')
    expect(html).toContain('<li>child</li>')
  })

  it('single bullet inside a blockquote still nests', () => {
    const html = carveToHtml('> intro\n> - child')
    expect(html).toContain('<blockquote>')
    expect(html).toContain('<li>child</li>')
  })

  it('lead text + single nested child in one item', () => {
    const html = carveToHtml('- parent text\n  - child')
    expect(html).toContain('<li>child</li>')
  })

  it('a heading after lead text in an item stays paragraph text (no blank line)', () => {
    const html = carveToHtml('- text\n  # H')
    expect(html).not.toContain('<h1>')
    expect(html).toContain('<li>text')
  })

  it('a generic div without a blank line stays paragraph text', () => {
    const html = carveToHtml('- item\n  :::\n  content\n  :::')
    expect(html).not.toContain('<div>')
    expect(html).toContain('<li>item')
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
