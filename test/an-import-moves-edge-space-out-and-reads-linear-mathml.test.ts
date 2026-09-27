import { describe, expect, it } from 'vitest'
import { htmlToCarve, parse, renderCarve } from '../src/index.js'

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
    ['nested strong with surrounding spaces', '<p>a <a href="/s"><b> x </b></a> b</p>', 'a [*x*](/s) b\n'],
    ['nested strong without surrounding spaces', '<p>a<a href="/s"><b> x </b></a>b</p>', 'a [*x*](/s) b\n'],
    ['nested strong at block edges', '<p><a href="/s"><b> x </b></a></p>', '[*x*](/s)\n'],
    ['formatting inside a span', '<p>a<span id="s"><b> x </b></span>b</p>', 'a [*x*]{#s} b\n'],
    ['nested formatting', '<p>a<a href="/s"><b><i> x </i></b></a>b</p>', 'a [*/x/*](/s) b\n'],
    ['internal formatting space', '<p>a<a href="/s">y<b> x </b>z</a>b</p>', 'a[y *x* z](/s)b\n'],
    ['insertion', '<p>a<a href="/s"><ins> x </ins></a>b</p>', 'a [{+x+}](/s) b\n'],
    ['deletion', '<p>a<a href="/s"><del> x </del></a>b</p>', 'a [{-x-}](/s) b\n'],
    ['formatting with a no-break space', '<p>a<a href="/s"><b>&nbsp;x&nbsp;</b></a>b</p>', 'a[* x *](/s)b\n'],
    ['code keeps its spaces', '<p>a<a href="/s"><code> x </code></a>b</p>', 'a[`  x  `](/s)b\n'],
    ['whitespace-only formatting', '<p>a<a href="/s">x<b> </b>y</a>b</p>', 'a[x{* *}y](/s)b\n'],
    ['a padded nested span', '<p>a<a href="/s"><span id="s"><b> x </b></span></a>b</p>', 'a [[*x*]{#s}](/s) b\n'],
    ['an image inside formatting', '<p>a<a href="/s"><b> <img src="i.png" alt="i"> </b></a>b</p>', 'a [*![i](i.png)*](/s) b\n'],
    ['a link inside standalone formatting', '<p>a<b><a href="/s"><i> x </i></a></b>b</p>', 'a{* [/x/](/s) *}b\n'],
    ["formatting after a hard break", "<p>a<a href=\"/s\">x<br><b> y</b></a>b</p>", "a[x\\\n*y*](/s)b\n"],
    ["a tab after a hard break", "<p>a<a href=\"/s\">x<br><b>\ty</b></a>b</p>", "a[x\\\n*y*](/s)b\n"],
    ["span formatting after a hard break", "<p>a<span id=\"k\">x<br><i> y</i></span>b</p>", "a[x\\\n/y/]{#k}b\n"],
  ])('moves it out at %s', (_, html, carve) => {
    const result = htmlToCarve(html)
    expect(result.value).toBe(carve)
    expect(renderCarve(parse(result.value))).toBe(result.value)
    expect(result.report.diagnostics).toEqual([])
  })

  it('keeps math inside formatting and attributes its diagnostic to the authored node', () => {
    const result = htmlToCarve('<p>a<a href="/s"><b> <math alttext="x"></math> </b></a>b</p>')
    expect(result.value).toBe('a [*$`x`*](/s) b\n')
    expect(result.report.diagnostics).toEqual([
      expect.objectContaining({ code: 'encoding-assumed', path: '/p[1]/a[2]/b[1]/math[2]' }),
    ])
  })

  it('attributes an unspellable nested insertion to its authored node', () => {
    const result = htmlToCarve('<p>a<a href="/s"><ins><ins> x </ins></ins></a>b</p>')
    expect(result.value).toBe('a [{+x+}](/s) b\n')
    expect(result.report.diagnostics).toEqual([
      expect.objectContaining({ code: 'structure-unspellable', path: '/p[1]/a[2]/ins[1]/ins[1]' }),
    ])
  })

  it.each([
    ['whitespace-only content', '<p>a <a href="/w"> </a> b</p>', 'a [ ](/w) b\n'],
    ['a no-break space', '<p>a <a href="/n"> nb </a> b</p>', 'a [ nb ](/n) b\n'],
    ['standalone formatting', '<p>a<b> x </b>b</p>', 'a{* x *}b\n'],
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

  it('keeps a space where mspace separates two words or numbers', () => {
    expect(htmlToCarve('<p><math><mn>1</mn><mspace width="1em"></mspace><mn>2</mn></math></p>').value).toBe('1 2\n')
    expect(htmlToCarve('<p><math><mi>x</mi><mo>,</mo><mspace></mspace><mi>y</mi><mspace></mspace></math></p>').value).toBe('x,y\n')
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
