import { describe, it, expect } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

const h = (s: string) => carveToHtml(s).replace(/>\s+</g, '><').trim()

// markup-carve/carve#4457, PART 10 §1: HTML attribute names compare ASCII
// case-insensitively in every merge, and a structural value wins over an
// authored copy of its name.
describe('an HTML attribute is written once, whatever its case', () => {
  it('omits an authored copy of a structural attribute', () => {
    expect(h('{type=x}\na. alpha')).toBe('<ol type="a"><li>alpha</li></ol>')
    expect(h('{START=9}\n3. x')).toBe('<ol start="3"><li>x</li></ol>')
    expect(h('{data-delim=x}\na) alpha')).toBe('<ol type="a" data-delim=")"><li>alpha</li></ol>')
    expect(h('![a](/u.png){ALT=z}')).toBe('<img src="/u.png" alt="a">')
    expect(h('x[^1]{role=v HREF=w}\n\n[^1]: n')).toContain('<a id="fnref1" href="#fn1" role="doc-noteref"><sup>1</sup></a>')
  })

  it('keeps an authored attribute the element does not derive', () => {
    expect(h('{start=9}\n1. x')).toBe('<ol start="9"><li>x</li></ol>')
    expect(h('[a](/u){title=t}')).toBe('<p><a href="/u" title="t">a</a></p>')
  })

  it('writes a name once at its first spelling with the last value', () => {
    expect(h('{K=1 k=2}\npara')).toBe('<p K="2">para</p>')
    expect(h('{k=1 K=2}\npara')).toBe('<p k="2">para</p>')
    expect(h('{K=1 k=2 K=3}\npara')).toBe('<p K="3">para</p>')
    expect(h('{K=1}\n{k=2}\npara')).toBe('<p K="2">para</p>')
    expect(h('*x*{K=1 k=2}')).toBe('<p><strong K="2">x</strong></p>')
  })

  it('folds a CLASS or ID key into its slot', () => {
    expect(h('{CLASS=z}\n::: |\nverse\n:::')).toBe('<div CLASS="z line-block"><p>verse</p></div>')
    expect(h('[x]{.a CLASS=b ID=c #d}')).toBe('<p><span class="a b" ID="d">x</span></p>')
    expect(h('{CLASS=z}\n::: note\nx\n:::')).toBe('<aside class="admonition note z" aria-label="Note"><p>x</p></aside>')
    expect(h('{CLASS=p}\n- [x] t')).toContain('<ul class="task-list p">')
  })

  it('reads an ID key as the authored id of a heading and a footnote reference', () => {
    expect(h('{ID=q}\n# h')).toBe('<section id="q"><h1>h</h1></section>')
    expect(h('> {ID=q}\n> # h')).toBe('<blockquote><h1 ID="q">h</h1></blockquote>')
    expect(h('x[^1]{ID=x}\n\n[^1]: n')).toContain('<a id="x" href="#fn1" role="doc-noteref"><sup>1</sup></a>')
  })

  it('gives a derived semantic attribute the authored value at its slot', () => {
    expect(h('[x]{abbr="a" TITLE="d"}')).toBe('<p><abbr title="d">x</abbr></p>')
    expect(h('[x]{.a DATETIME=b time="2020"}')).toBe('<p><time datetime="b" class="a">x</time></p>')
  })

  it('merges a cell alignment into an authored style', () => {
    expect(h('|>{style="color:red"} a |')).toBe('<table><tbody><tr><td style="color:red; text-align: right;">a</td></tr></tbody></table>')
    expect(h('|~{style=p STYLE=q} a |')).toBe('<table><tbody><tr><td style="q; text-align: center;">a</td></tr></tbody></table>')
  })

  it('writes the last spelling again so the re-parse keeps its value', () => {
    const src = '{K=1 k=2 K=3}\npara\n'
    expect(carveToCarve(src)).toBe('{K=3 k=2 K=3}\npara\n')
    expect(h(carveToCarve(src))).toBe(h(src))
  })
})
