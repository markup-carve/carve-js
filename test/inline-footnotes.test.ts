import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const h = (s: string) => carveToHtml(s)

describe('inline footnotes ^[content]', () => {
  it('renders an inline footnote as a numbered endnote', () => {
    const out = h('Text with a note^[a quick aside] inline.\n')
    expect(out).toContain(
      '<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a>',
    )
    expect(out).toContain('<section role="doc-endnotes">')
    expect(out).toContain(
      '<li id="fn1">\n      <p>a quick aside<a href="#fnref1" role="doc-backlink">↩</a></p>\n    </li>',
    )
  })

  it('interleaves numbering with reference footnotes by document order', () => {
    const out = h('A note^[first] then a ref[^a].\n\n[^a]: second.\n')
    expect(out).toContain('<sup>1</sup>') // inline note is 1
    expect(out).toContain('href="#fn2"') // ref resolves to 2
    expect(out).toContain('<li id="fn1">')
    expect(out).toContain('<li id="fn2">')
  })

  it('parses inline content inside the note', () => {
    // Carve uses `*` for strong and `_` for emphasis (djot, swapped from MD).
    const out = h('See^[a *bold* and `code`] here.\n')
    expect(out).toContain('<strong>bold</strong>')
    expect(out).toContain('<code>code</code>')
  })

  it('treats empty and whitespace-only content as literal', () => {
    expect(h('x^[] y\n')).toContain('^[]')
    expect(h('x^[ ] y\n')).toContain('^[ ]')
    expect(h('x^[] y\n')).not.toContain('doc-noteref')
  })

  it('treats an unclosed opener as literal', () => {
    const out = h('See ^[unclosed here\n')
    expect(out).toContain('^[unclosed here')
    expect(out).not.toContain('doc-noteref')
  })

  it('opens a note after a literal caret (^^[x] = literal ^ + note)', () => {
    // There is no bare superscript, so a `^` is plain text and the second
    // `^[` opens a note as anywhere else.
    const out = h('a^^[x] b\n')
    expect(out).toContain('doc-noteref')
    expect(out).toContain('a^<a')
  })

  it('keeps the opener escapable with a backslash', () => {
    const out = h('lit \\^[x]\n')
    expect(out).not.toContain('doc-noteref')
    expect(out).toContain('^[x]')
  })

  it('does not close on an escaped bracket or a bracket in a code span', () => {
    const esc = h('See^[a \\] b] end.\n')
    expect(esc).toContain('a ] b')
    const code = h('See^[a `]` b] end.\n')
    expect(code).toContain('<code>]</code>')
  })

  it('allows a balanced nested bracket in the content', () => {
    const out = h('See^[a [link](/u) here] end.\n')
    expect(out).toContain('<a href="/u">link</a>')
  })

  it('does not recognize a footnote reference inside note content', () => {
    const out = h('See^[inner [^a] ref] end.\n\n[^a]: def.\n')
    // [^a] inside the note stays literal; only fn1 (the inline note) exists.
    expect(out).toContain('<li id="fn1">')
    expect(out).not.toContain('<li id="fn2">')
    expect(out).toContain('[^a]')
  })

  it('attaches a trailing attribute block to the noteref (like a reference)', () => {
    const out = h('x^[note]{.c} y\n')
    expect(out).toContain('doc-noteref')
    expect(out).toContain('class="c"')
    expect(out).not.toContain('{.c}')
  })

  it('keeps a caret with no following bracket literal', () => {
    // There is no bare superscript: `^2^` is literal text; superscript is
    // the braced `{^2^}` form only.
    expect(h('^2^ y\n')).toContain('^2^ y')
    expect(h('{^2^} y\n')).toContain('<sup>2</sup>')
  })

  it('resolves an implicit heading reference inside note content', () => {
    const out = h('# Title\n\nsee^[go [Title][]] here.\n')
    // The [Title][] implicit ref inside the note resolves to #Title, not <a href="">.
    expect(out).toContain('<a href="#Title">Title</a>')
    expect(out).not.toContain('<a href="">')
  })

  it('suppresses footnotes nested inside note content via inline markup', () => {
    // The inner ^[...] must stay literal even when wrapped in emphasis, a span,
    // or link text — footnote mode propagates through recursive inline parsing
    // (no leaked, unnumbered [^] fallback). Design §3.1.
    for (const src of [
      'See^[outer *^[inner]* x] end.\n',
      'See^[a [lbl ^[z]]{.x} b] end.\n',
      'See^[a [t ^[z]](/u) b] end.\n',
    ]) {
      const out = h(src)
      expect(out).not.toContain('[^]') // no leaked unresolved-footnote fallback
      expect(out).not.toContain('<li id="fn2">') // only the one outer note
      expect(out).toContain('^[') // inner opener stays literal text
    }
  })
})
