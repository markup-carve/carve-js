// The clauses that the specification commits after "fix what the review of today's clauses found"
// added or changed, one test per clause id.
import { describe, expect, it } from 'vitest'
import { type AstNode, render } from '../src/index.ts'
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
