import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const html = (s: string) => carveToHtml(s)

describe('definition descriptions continue like list items (loose + `+`)', () => {
  it('form A: a blank + indented block makes a multi-paragraph <dd>', () => {
    expect(html(':: term\n:  First para.\n\n   Second para.')).toBe(
      '<dl>\n  <dt>term</dt>\n  <dd>\n    <p>First para.</p>\n    <p>Second para.</p>\n  </dd>\n</dl>',
    )
  })

  it('form B: a lone `+` attaches a flush-left paragraph to the <dd>', () => {
    expect(html(':: term\n:  First para.\n+\nSecond para.')).toBe(
      '<dl>\n  <dt>term</dt>\n  <dd>\n    <p>First para.</p>\n    <p>Second para.</p>\n  </dd>\n</dl>',
    )
  })

  it('form B: `+` attaches a flush-left block (blockquote) with no indentation', () => {
    expect(html(':: term\n:  Intro.\n+\n> a quote')).toBe(
      '<dl>\n  <dt>term</dt>\n  <dd>\n    <p>Intro.</p>\n    <blockquote><p>a quote</p></blockquote>\n  </dd>\n</dl>',
    )
  })

  it('forms A and B compose in one <dd>', () => {
    expect(html(':: term\n:  One.\n\n   Two.\n+\nThree.')).toBe(
      '<dl>\n  <dt>term</dt>\n  <dd>\n    <p>One.</p>\n    <p>Two.</p>\n    <p>Three.</p>\n  </dd>\n</dl>',
    )
  })

  it('multiple `:  ` lines still render separate <dd>s (not paragraphs)', () => {
    expect(html(':: term\n:  a\n:  b')).toBe(
      '<dl>\n  <dt>term</dt>\n  <dd>a</dd>\n  <dd>b</dd>\n</dl>',
    )
  })

  it('a single-paragraph definition stays tight (no <p> wrapper)', () => {
    expect(html(':: term\n:  just one')).toBe(
      '<dl>\n  <dt>term</dt>\n  <dd>just one</dd>\n</dl>',
    )
  })

  it('the single-blank entry separator before the next `:: term` still works', () => {
    expect(html(':: t1\n:  a\n\n:: t2\n:  b')).toBe(
      '<dl>\n  <dt>t1</dt>\n  <dd>a</dd>\n  <dt>t2</dt>\n  <dd>b</dd>\n</dl>',
    )
  })

  it('`+ text` (with content) is not the `+` marker; it lazily continues the definition', () => {
    // A bare `+` on its own line is the continuation marker; `+ text` is plain
    // paragraph text, so it lazily folds into the open <dd> (like a list item).
    expect(html(':: term\n:  a\n+ not a marker')).toBe(
      '<dl>\n  <dt>term</dt>\n  <dd>a\n+ not a marker</dd>\n</dl>',
    )
  })

  it('a flush-left line lazily continues the open definition paragraph', () => {
    expect(html(':: term\n:  a wrapped message that\ncontinues on the next line')).toBe(
      '<dl>\n  <dt>term</dt>\n  <dd>a wrapped message that\ncontinues on the next line</dd>\n</dl>',
    )
  })

  it('a block opener (not a marker) ends the definition instead of folding', () => {
    expect(html(':: term\n:  def\n# heading')).toBe(
      '<dl>\n  <dt>term</dt>\n  <dd>def</dd>\n</dl>\n<section id="heading">\n  <h1>heading</h1>\n</section>',
    )
  })

  it('a blank line closes the paragraph, so a later flush-left line ends the definition', () => {
    expect(html(':: term\n:  def\n\nafter blank')).toBe(
      '<dl>\n  <dt>term</dt>\n  <dd>def</dd>\n</dl>\n<p>after blank</p>',
    )
  })

  it('first-block: `:  +` opens a definition whose body is the following flush-left block', () => {
    expect(html(':: t\n:  +\n> a quote')).toBe(
      '<dl>\n  <dt>t</dt>\n  <dd>\n    <blockquote><p>a quote</p></blockquote>\n  </dd>\n</dl>',
    )
  })

  it('first-block: `:  +` with a code block', () => {
    expect(html(':: t\n:  +\n```\ncode\n```')).toBe(
      '<dl>\n  <dt>t</dt>\n  <dd>\n    <pre><code>code\n</code></pre>\n  </dd>\n</dl>',
    )
  })

  it('an escaped `:  \\+` keeps a literal plus as content', () => {
    expect(html(':: t\n:  \\+')).toBe('<dl>\n  <dt>t</dt>\n  <dd>+</dd>\n</dl>')
  })
})

describe('footnote definitions accept the `+` pull-left continuation', () => {
  it('a lone `+` attaches a flush-left paragraph to the note body', () => {
    expect(html('X.[^a]\n\n[^a]: First.\n+\nSecond.')).toBe(
      '<p>X.<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a></p>\n' +
        '<section role="doc-endnotes">\n  <hr>\n  <ol>\n    <li id="fn1">\n' +
        '      <p>First.</p>\n      <p>Second.<a href="#fnref1" role="doc-backlink">↩</a></p>\n' +
        '    </li>\n  </ol>\n</section>',
    )
  })
})
