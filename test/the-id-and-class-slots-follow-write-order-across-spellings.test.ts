import { describe, it, expect } from 'vitest'
import { carveToHtml, parse, renderHtml, toAstJson } from '../src/index.js'

const h = (s: string) => carveToHtml(s).replace(/>\s+</g, '><').trim()

// markup-carve/carve-js#4065, PART 10 §1: the id slot takes the value written
// last and the class slot keeps every class in source order, in every spelling.
describe('the id and class slots follow write order across spellings', () => {
  it('gives the id slot the value written last', () => {
    expect(h('{ID=p id=q ID=r}\npara')).toBe('<p ID="r">para</p>')
    expect(h('{id=b ID=c #a}\npara')).toBe('<p id="a">para</p>')
    expect(h('{id}\n{ID}\n{#a}\npara')).toBe('<p id="a">para</p>')
    expect(h('[t]{#a ID=c}{id=b}')).toBe('<p><span id="b">t</span></p>')
    expect(h('{#a id=b ID=c}\n# H')).toBe('<section id="c"><h1>H</h1></section>')
  })

  it('keeps every class of a repeated CLASS key in source order', () => {
    expect(h('{CLASS=p}\n{Class=q}\n{CLASS=r}\npara')).toBe('<p CLASS="p q r">para</p>')
    expect(h('{class=q}\n{CLASS=r}\n{.p}\npara')).toBe('<p class="q r p">para</p>')
    expect(h('*t*{.p}{CLASS="t u"}{class=q}')).toBe('<p><strong class="p t u q">t</strong></p>')
    expect(h('{CLASS=r CLASS=p ID=c}\n# H')).toBe('<section id="c"><h1 CLASS="r p">H</h1></section>')
  })

  it('does not change the published AST', () => {
    expect(toAstJson(parse('{ID=p id=q ID=r}\npara')).children[0]).toMatchObject({
      attrs: { id: 'q', keyValues: { ID: 'r' } },
    })
  })

  it('renders an id a caller set after parsing', () => {
    const doc = parse('{ID=p id=q ID=r}\npara')
    const para = doc.children[0]!
    para.attrs = { ...para.attrs, id: 'z' }
    expect(renderHtml(doc).trim()).toBe('<p ID="z">para</p>')
  })
})
