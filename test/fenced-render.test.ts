import { describe, expect, it } from 'vitest'

import { abc, carveToHtml, chart, d2, fencedRender, graphviz, mermaid, vegaLite } from '../src/index.js'

describe('fencedRender factory', () => {
  it('text mode escapes & and < but keeps > (arrow syntax)', () => {
    expect(carveToHtml('``` d2\na -> b & <c\n```', { extensions: [d2()] })).toBe(
      '<pre class="d2">a -> b &amp; &lt;c</pre>',
    )
  })

  it('graphviz preset claims both dot and graphviz', () => {
    expect(carveToHtml('``` dot\na -> b\n```', { extensions: [graphviz()] })).toBe(
      '<pre class="graphviz">a -> b</pre>',
    )
    expect(carveToHtml('``` graphviz\na -> b\n```', { extensions: [graphviz()] })).toBe(
      '<pre class="graphviz">a -> b</pre>',
    )
  })

  it('json mode wraps the body in a script tag inside a div', () => {
    expect(carveToHtml('``` vega-lite\n{"mark": "bar"}\n```', { extensions: [vegaLite()] })).toBe(
      '<div class="vega-lite"><script type="application/json">{"mark": "bar"}</script></div>',
    )
  })

  it('json mode guards </ so the body cannot close the script early', () => {
    const html = carveToHtml('``` vega-lite\n{"x": "</script>"}\n```', { extensions: [vegaLite()] })
    expect(html).toBe(
      '<div class="vega-lite"><script type="application/json">{"x": "<\\/script>"}</script></div>',
    )
    // Only the wrapper's closing tag, none from the body.
    expect(html.match(/<\/script>/g)?.length).toBe(1)
  })

  it('json mode defaults the wrapper tag to div', () => {
    const html = carveToHtml('``` chart\n{}\n```', { extensions: [chart()] })
    expect(html).toBe('<div class="chart"><script type="application/json">{}</script></div>')
  })

  it('defers an unclaimed language to the core renderer', () => {
    const html = carveToHtml('``` python\nprint(1)\n```', { extensions: [d2()] })
    expect(html).toContain('class="language-python"')
    expect(html).not.toContain('class="d2"')
  })

  it('merges author classes and copies attributes', () => {
    // js renderAttrs emits author slots in source order, then appends the
    // synthesized cssClass (the author wrote no class here, so it comes last).
    expect(carveToHtml('{#chart1 data-theme=dark}\n``` d2\na -> b\n```', { extensions: [d2()] })).toBe(
      '<pre id="chart1" data-theme="dark" class="d2">a -> b</pre>',
    )
  })

  it('strips event-handler attributes (always-on hardening)', () => {
    expect(
      carveToHtml('{#chart1 .tall onclick="alert(1)"}\n``` d2\na -> b\n```', { extensions: [d2()] }),
    ).toBe('<pre id="chart1" class="d2 tall">a -> b</pre>')
  })

  it('wraps in a figure when requested', () => {
    const html = carveToHtml('``` d2\na\n```', {
      extensions: [fencedRender({ language: 'd2', wrapInFigure: true })],
    })
    expect(html).toContain('<figure class="d2-figure">')
    expect(html).toContain('<pre class="d2">a</pre>')
    expect(html).toContain('</figure>')
  })

  it('honors a custom tag and cssClass', () => {
    expect(
      carveToHtml('``` d2\na -> b\n```', {
        extensions: [fencedRender({ language: 'd2', cssClass: 'diagram', tag: 'div' })],
      }),
    ).toBe('<div class="diagram">a -> b</div>')
  })

  it('abc preset renders a text-mode pre', () => {
    expect(carveToHtml('``` abc\nCDEF\n```', { extensions: [abc()] })).toBe(
      '<pre class="abc">CDEF</pre>',
    )
  })

  it('mermaid is a text-mode preset (byte-identical to mermaid())', () => {
    const src = '``` mermaid\ngraph TD; A-->B\n```'
    expect(carveToHtml(src, { extensions: [fencedRender({ language: 'mermaid' })] })).toBe(
      carveToHtml(src, { extensions: [mermaid()] }),
    )
  })

  it('throws on an empty language', () => {
    expect(() => fencedRender({ language: '' })).toThrow()
  })
})
