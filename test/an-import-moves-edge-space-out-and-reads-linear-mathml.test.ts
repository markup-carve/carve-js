import { describe, expect, it } from 'vitest'
import { htmlToCarve } from '../src/index.js'

// markup-carve/carve#2361.
describe('a link or span keeps its edge whitespace outside it', () => {
  it.each([
    ['the label', '<p>Source: <a href="https://jma.go.jp/"> Japan Meteorological Agency </a>.</p>', 'Source: [Japan Meteorological Agency](https://jma.go.jp/) .\n'],
    ['a space already outside', '<p>a <a href="/x"> x</a></p>', 'a [x](/x)\n'],
    ['words that would merge', '<p>x<a href="/y"> y</a>z</p>', 'x [y](/y)z\n'],
    ['a block edge', '<p><a href="/s"> start</a></p>', '[start](/s)\n'],
    ['a strong at the edge', '<p>a <a href="/b"> <b>bold</b> </a> b</p>', 'a [*bold*](/b) b\n'],
    ['an image at the edge', '<p>b<a href="/i"> <img src="i.png" alt="i"> </a>c</p>', 'b [![i](i.png)](/i) c\n'],
    ['a span', '<p>a<span id="k"> key </span>b</p>', 'a [key]{#k} b\n'],
    ['a span inside a link', '<p>a<a href="/n"><span class="c"> n </span></a>b</p>', 'a [[n]{.c}](/n) b\n'],
  ])('moves it out at %s', (_, html, carve) => {
    const result = htmlToCarve(html)
    expect(result.value).toBe(carve)
    expect(result.report.diagnostics).toEqual([])
  })

  it.each([
    ['whitespace-only content', '<p>a <a href="/w"> </a> b</p>', 'a [ ](/w) b\n'],
    ['a no-break space', '<p>a <a href="/n"> nb </a> b</p>', 'a [ nb ](/n) b\n'],
    ['the inside of a strong', '<p>a <a href="/s"><b> x </b></a> b</p>', 'a [{* x *}](/s) b\n'],
  ])('leaves %s alone', (_, html, carve) => {
    expect(htmlToCarve(html).value).toBe(carve)
  })
})

describe('MathML with no TeX', () => {
  it('imports a linear token run as its text, and says so', () => {
    const result = htmlToCarve('<p>A <math><mi>a</mi><mo>+</mo><mi>a</mi><mo>=</mo><mn>2</mn><mi>a</mi></math> B</p>')
    expect(result.value).toBe('A a+a=2a B\n')
    expect(result.report.diagnostics).toEqual([
      expect.objectContaining({ code: 'element-unwrapped', severity: 'warning', fidelity: 'degraded', path: '/p[1]/math[2]' }),
    ])
  })

  it('reads through grouping elements and semantics, and skips mspace', () => {
    const html = '<p><math><semantics><mrow><mstyle><mi mathvariant="normal">∀</mi><mi>x</mi><mo>∈</mo><mi>X</mi>'
      + '<mo>,</mo><mspace width="1em"></mspace><mi>y</mi><mtext> if  y </mtext></mstyle></mrow>'
      + '<annotation encoding="text/plain">not this</annotation></semantics></math></p>'
    expect(htmlToCarve(html).value).toBe('∀x∈X,yif y\n')
  })

  it.each(['<mfrac><mn>1</mn><mn>2</mn></mfrac>', '<msup><mi>x</mi><mn>2</mn></msup>', '<mphantom><mi>x</mi></mphantom>', '<mi><mglyph></mglyph></mi>'])(
    'keeps the drop for %s',
    (inner) => {
      const result = htmlToCarve(`<p>v <math>${inner}</math></p>`)
      expect(result.value).toBe('v\n')
      expect(result.report.diagnostics.map((d) => d.code)).toEqual(['element-dropped'])
    },
  )

  it('keeps roundtrip on the raw arm', () => {
    const result = htmlToCarve('<p><math><mi>a</mi></math></p>', { mode: 'roundtrip' })
    expect(result.report.diagnostics.map((d) => d.code)).toEqual(['raw-preserved'])
  })
})

describe('a formula beside its fallback image imports once', () => {
  it('drops the image when its alt is the TeX the formula imported', () => {
    const html = '<p>I <span class="w"><span class="m"><math><semantics><mi>a</mi>'
      + '<annotation encoding="application/x-tex">a^2</annotation></semantics></math></span>'
      + '<img src="f.svg" alt="a^2"></span> x</p>'
    const result = htmlToCarve(html)
    expect(result.value).toBe('I [[$`a^2`]{.m}]{.w} x\n')
    expect(result.report.diagnostics).toEqual([
      expect.objectContaining({ code: 'element-dropped', severity: 'info', path: '/p[1]/span[2]/img[2]' }),
    ])
  })

  it('reads the image alt as TeX when the math has none and the page hid it', () => {
    const result = htmlToCarve('<p>Or <span class="m" style="display: none"><math><mi>b</mi></math></span><img src="g.svg" alt="b^2"> there.</p>')
    expect(result.value).toBe('Or [$`b^2`]{.m} there.\n')
    expect(result.report.diagnostics.map((d) => [d.code, d.severity])).toEqual([
      ['style-unmapped', 'info'],
      ['encoding-assumed', 'info'],
      ['element-dropped', 'info'],
    ])
    expect(htmlToCarve('<p><math style="DISPLAY:none !important"><mi>b</mi></math><img src="g.svg" alt="b^2"></p>').value).toBe('$`b^2`\n')
  })

  it('reads the effective display, not any display', () => {
    const portrait = '<img src="portrait.png" alt="Portrait">'
    expect(htmlToCarve(`<p><math style="display:none;display:block"><mi>x</mi></math>${portrait}</p>`).value).toBe('x![Portrait](portrait.png)\n')
    expect(htmlToCarve(`<p><math style="display:none !important;display:block"><mi>x</mi></math>${portrait}</p>`).value).toBe('$`Portrait`\n')
  })

  it('does not read the alt of an image beside a formula the page shows', () => {
    const result = htmlToCarve('<p><math><mi>x</mi></math><img src="portrait.png" alt="Portrait of Ada"></p>')
    expect(result.value).toBe('x![Portrait of Ada](portrait.png)\n')
    expect(result.report.diagnostics.map((d) => d.code)).toEqual(['element-unwrapped'])
  })

  it('keeps an image that is not the fallback', () => {
    expect(htmlToCarve('<p>N <math alttext="x"></math> <img src="i.png" alt="icon"> one.</p>').value)
      .toBe('N $`x` ![icon](i.png) one.\n')
    // A wrapper that is not a span does not reach past its own edge.
    expect(htmlToCarve('<div><p><math alttext="y"></math></p><img src="j.png" alt="y"></div>').value)
      .toContain('![y](j.png)')
  })
})
