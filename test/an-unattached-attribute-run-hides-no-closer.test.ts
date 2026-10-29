import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// CARVE-P4-002: an attribute run attaches only to the construct it follows.
// Anywhere else it is text, and a closer inside its quoted value closes.
const html = (src: string) => carveToHtml(src).trimEnd()

describe('an unattached attribute run hides no closer', () => {
  it('closes inside a run after plain text', () => {
    expect(html('{*x{title="*}"} b*}')).toBe('<p><strong>x{title=“</strong>”} b*}</p>')
  })

  it('closes inside a run at the start of the span', () => {
    expect(html('{*{title="*}"} b*}')).toBe('<p><strong>{title=“</strong>”} b*}</p>')
  })

  it('closes inside a run after an editorial comment or a cross-reference', () => {
    expect(html('{*a{#c#}{title="*}"} b*}')).toBe('<p><strong>a<span class="critic-comment">c</span>{title=“</strong>”} b*}</p>')
    expect(html('{*</#h>{title="*}"} b*}')).toBe('<p><strong>&lt;/#h&gt;{title=“</strong>”} b*}</p>')
  })

  it('closes inside a run after a delimiter that closes nothing', () => {
    expect(html('{*a*{title="*}"} b*}')).toBe('<p><strong>a*{title=“</strong>”} b*}</p>')
    expect(html('{_a*b*{title="_}"} b_}')).toBe('<p><u>a*b*{title=“</u>”} b_}</p>')
    expect(html('{*x+}{title="*}"} y*}')).toBe('<p><strong>x+}{title=“</strong>”} y*}</p>')
  })

  it('closes inside a run for the combined token and the other braced kinds', () => {
    expect(html('/*x{title="*/"} b*/')).toBe('<p><strong><em>x{title=“</em></strong>”} b*/</p>')
    expect(html('{=x{title="=}"} b=}')).toBe('<p><mark>x{title=“</mark>”} b=}</p>')
    expect(html('{~x{title="~}"} b~}')).toBe('<p><s>x{title=“</s>”} b~}</p>')
  })

  it('still hides a closer in a run that attaches', () => {
    expect(html('{*[a](u){title="*}"} b*}')).toBe('<p><strong><a href="u" title="*}">a</a> b</strong></p>')
    expect(html('{*`c`{title="*}"} b*}')).toBe('<p><strong><code title="*}">c</code> b</strong></p>')
    expect(html('{*_a_{title="*}"} b*}')).toBe('<p><strong><u title="*}">a</u> b</strong></p>')
    expect(html('{*:sym:{title="*}"} b*}')).toBe('<p><strong><span title="*}">:sym:</span> b</strong></p>')
  })

  it('reads no attribute run in an editorial insert or delete', () => {
    expect(html('{+`c`{title="+}"} b+}')).toBe('<p><ins><code>c</code>{title=“</ins>”} b+}</p>')
    expect(html('{-[a](u){title="-}"} b-}')).toBe('<p><del><a href="u">a</a>{title=“</del>”} b-}</p>')
    expect(html('{+_a_{title="+}"} b+}')).toBe('<p><ins><u>a</u>{title=“</ins>”} b+}</p>')
  })

  it('hides a closer in a run after a shortcode from the bare walk', () => {
    expect(html('*:sym:{title="*"} b*')).toBe('<p><strong><span title="*">:sym:</span> b</strong></p>')
  })

  it('reads a link right after a braced superscript opener', () => {
    expect(html('{^[a](u^}) b^}')).toBe('<p><sup><a href="u^}">a</a> b</sup></p>')
  })
})
