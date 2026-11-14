// The clauses that the specification commits after "fix what the review of today's clauses found"
// added or changed, one test per clause id.
import { describe, expect, it } from 'vitest'
import { type AstNode, formatWithDiagnostics, render, renderWithDiagnostics, write } from '../src/index.ts'
import { documentOf, paragraph, text } from './support/tree.ts'

const CONTROLS = '‪‮⁦⁩'
const TICK = '`'

function inline(node: AstNode): AstNode {
  return documentOf(paragraph(node))
}

describe('the bidirectional controls', () => {
  it('C2-H-172: they are not written in a title paragraph or a label paragraph', () => {
    expect(render(`::: note "T${CONTROLS}t" [L${CONTROLS}l]\nx\n:::`)).toBe(
      '<aside class="admonition note" aria-labelledby="adm-1">\n  <p class="admonition-title" id="adm-1">Tt</p>\n'
      + '  <p class="div-label">Ll</p>\n  <p>x</p>\n</aside>')
  })

  it('C2-H-172: they are not written in the text of a cross-reference', () => {
    expect(render(`{#h}\n# A${CONTROLS}b\n\nsee </#h>`)).toContain('<a href="#h">Ab</a>')
  })

  it('C2-H-172: they are not written in static math', () => {
    expect(render(`$${TICK}a${CONTROLS}b${TICK}`, { mode: 'static' })).toBe('<p><code class="language-math">ab</code></p>')
  })

  it('C2-H-172: they are not written in the text of an autolink', () => {
    expect(render(inline({ type: 'autolink', href: 'https://a.b', text: `a${CONTROLS}b` })))
      .toBe('<p><a href="https://a.b">ab</a></p>')
  })

  it('C2-H-172: they are not written in an editorial comment', () => {
    expect(render(`a {#ed${CONTROLS}it#} b`)).toBe('<p>a <span class="critic-comment">edit</span> b</p>')
  })

  it('C2-H-172: they are not written in an unresolved reference written as text', () => {
    expect(render(`[x][k${CONTROLS}k]`)).toBe('<p>[x][kk]</p>')
  })

  it('C2-H-172: they are not written in a symbol written as its source', () => {
    expect(render(inline({ type: 'symbol', name: `s${CONTROLS}y` }))).toBe('<p>:sy:</p>')
  })

  it('C2-H-172: they are not written in an unexpanded include', () => {
    expect(render(`{{ a${CONTROLS}.crv }}`)).toBe('<p>{{ a.crv }}</p>')
  })

  it('C2-H-172: they are not written in raw HTML that is escaped', () => {
    expect(render(`a ${TICK}x${CONTROLS}${TICK}{=html} b`)).toBe('<p>a x b</p>')
  })

  it('C2-H-172: they are not written in a degraded form', () => {
    expect(render(`# H${CONTROLS}h`, { profile: 'minimal' })).toBe('<p># Hh</p>')
    expect(render(documentOf(paragraph(text('a'), { type: 'symbol', name: `s${CONTROLS}y` })), { profile: 'minimal' }))
      .toBe('<p>a:sy:</p>')
  })

  it('C2-H-172: the text of a roundtrip carrier keeps them', () => {
    expect(render(`a ${TICK}x${CONTROLS}${TICK}{=html} b`, { roundtrip: true }))
      .toBe(`<p>a <span data-carve-raw="html">x${CONTROLS}</span> b</p>`)
  })

  it('C2-H-172: raw content passed through unescaped keeps them', () => {
    expect(render(`a ${TICK}x${CONTROLS}${TICK}{=html} b`, { rawHtml: true })).toBe(`<p>a x${CONTROLS} b</p>`)
  })
})

describe('the degraded forms', () => {
  const minimal = { profile: 'minimal' } as const

  it('C2-H-165: a description list gives one paragraph for each term and the degraded blocks of each description', () => {
    expect(render(':: term one\n: desc *a*\n\n  desc b\n:: term two\n: desc c', minimal))
      .toBe('<p>term one</p>\n<p>desc a</p>\n<p>desc b</p>\n<p>term two</p>\n<p>desc c</p>')
  })

  it('C2-H-165: the nodes inside a degraded node are not reported again', () => {
    const out = renderWithDiagnostics(':: term one\n: desc *a* [x](/u)\n', minimal)
    expect(out.diagnostics.filter((entry) => entry.code === 'profile-construct-degraded')).toHaveLength(1)
  })

  it('C2-H-165: an include is written as the source text of its directive, options included', () => {
    expect(render('{{ a.crv #s @lines:1-2 @cols:"a,b" }}', minimal)).toBe('<p>{{ a.crv #s @lines:1-2 @cols:"a,b" }}</p>')
  })

  it('C2-H-165: a heading is one # for each level and a space, whatever marker the source used', () => {
    expect(render('=== Deep', minimal)).toBe('<p>### Deep</p>')
  })

  it('C2-H-165: a no-break space, a break and a smart punctuation node give U+00A0, one space and the glyph', () => {
    expect(render('[a\\ b "q" x -- y\\\nz]{.c}', minimal)).toBe('<p>a&nbsp;b “q” x – y z</p>')
  })

  it('C2-H-165: a footnote reference is written as [^key]', () => {
    expect(render('a[^n]\n\n[^n]: note', minimal)).toBe('<p>a[^n]</p>')
  })

  it('C2-H-165: a comment gives no text, and a paragraph that holds only comments writes nothing', () => {
    expect(render('a {% c %} b', minimal)).toBe('<p>a  b</p>')
    expect(render('{% only %}', minimal)).toBe('')
    expect(render('> {% only %}', minimal)).toBe('')
  })
})

describe('the cols value of an include', () => {
  it('C2-A-181, C2-W-058: a cols value that kept its quotes formats to itself with no diagnostic', () => {
    const out = formatWithDiagnostics('{{ a.crv @cols:"a,b" }}')
    expect(out.source).toBe('{{ a.crv @cols:"a,b" }}\n')
    expect(out.diagnostics).toEqual([])
  })

  it('C2-W-058: the writer writes a stored cols value with no second pair', () => {
    expect(write(documentOf({ type: 'include', path: 'a.crv', options: [['cols', '"a b"']] }))).toBe('{{ a.crv @cols:"a b" }}\n')
  })

  it('C2-H-171: the renderer writes a cols value that kept its quotes as stored', () => {
    expect(render('{{ a.crv @cols:"a b" }}')).toBe('<p>{{ a.crv @cols:"a b" }}</p>')
  })
})
