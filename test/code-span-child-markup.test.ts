import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, htmlToAst, htmlToCarve } from '../src/index.js'
import cases from './fixtures/code-span-child-markup.json'

describe('code span child markup losses', () => {
  for (const item of cases) {
    it(item.name, () => {
      const result = htmlToCarve(item.html)
      const losses = result.report.diagnostics.filter(d => ['element-unwrapped', 'element-dropped'].includes(d.code))
      expect(losses.some(d => d.path?.startsWith('/p[1]/code[1]/'))).toBe(item.loss)
      expect(carveToHtml(result.value).trim()).toBe('<p><code>word</code></p>')
      expect(carveToCarve(result.value)).toBe(result.value)
    })
  }
  for (const mode of ['safe', 'semantic', 'roundtrip'] as const) {
    it(`${mode}: reports discarded markup without preservation claims`, () => {
      const html = '<p><code><span><strong class="k">word</strong></span></code></p>'
      for (const result of [htmlToAst(html, { mode }), htmlToCarve(html, { mode })]) {
        expect(result.report.diagnostics.map(d => [d.code, d.path, d.fidelity])).toEqual([
          ['element-unwrapped', '/p[1]/code[1]/span[1]/strong[1]', 'degraded'],
          ['attribute-dropped', '/p[1]/code[1]/span[1]/strong[1]', 'dropped'],
        ])
      }
    })
    it.each(['q', 'math', 'ruby', 'summary', 'code', 'unknown'])(`${mode}: unwraps %s exactly once`, tag => {
      const result = htmlToCarve(`<code><${tag}>word</${tag}></code>`, { mode })
      expect(result.value).toBe('`word`\n')
      expect(result.report.diagnostics.map(d => d.code)).toEqual(['element-unwrapped'])
    })
    it.each(['br', 'input', 'img'])(`${mode}: drops %s exactly once`, tag => {
      const result = htmlToCarve(`<p><code><${tag}>word</code></p>`, { mode })
      expect(result.value).toBe('`word`\n')
      expect(result.report.diagnostics.map(d => d.code)).toEqual(['element-dropped'])
    })
    it(`${mode}: omits active payload and reports comments`, () => {
      const result = htmlToCarve('<p><code>a<script>b</script><!--c-->d</code></p>', { mode })
      expect(result.value).toBe('`ad`\n')
      expect(result.report.diagnostics.map(d => [d.code, d.path])).toEqual([
        ['element-dropped', '/p[1]/code[1]/script[2]'],
        ['element-dropped', '/p[1]/code[1]/comment()[3]'],
      ])
    })
    it(`${mode}: reports a nested block boundary once`, () => {
      const result = htmlToCarve('<code><b><div>a</div>b</b></code>', { mode })
      expect(result.report.diagnostics.filter(d => d.code === 'structure-unspellable')).toHaveLength(1)
      expect(carveToHtml(result.value).trim()).toBe('<p><code>ab</code></p>')
    })
  }
  it('charges discarded active descendants against the import budget', () => {
    const html = '<p><code><script>x</script></code></p>'
    for (const convert of [htmlToAst, htmlToCarve]) {
      expect(() => convert(html, { maxNodes: 4 })).not.toThrow()
      expect(() => convert(html, { maxNodes: 3 })).toThrow()
    }
  })
  it('charges template content against both limits', () => {
    const html = '<p><code><template><b>x</b></template>word</code></p>'
    expect(() => htmlToAst(html, { maxNodes: 5 })).toThrow()
    expect(() => htmlToAst(html, { maxDepth: 4 })).toThrow()
    expect(() => htmlToAst(html, { maxNodes: 6, maxDepth: 5 })).not.toThrow()
  })
  it('keeps footnote-looking text inside code and names source elements', () => {
    const html = '<p><code>x<sup><a href="#fn1" role="doc-noteref">1</a></sup></code></p><section role="doc-endnotes"><ol><li id="fn1"><p>note</p></li></ol></section>'
    const result = htmlToCarve(html)
    expect(carveToHtml(result.value)).toContain('<code>x1</code>')
    expect(result.report.diagnostics.every(d => !d.message.includes('carve-footnote-ref'))).toBe(true)
    expect(result.report.diagnostics.filter(d => d.path?.startsWith('/p[1]/code[1]/')).map(d => d.code)).toEqual([
      'element-unwrapped', 'element-unwrapped', 'attribute-dropped', 'attribute-dropped',
    ])
  })
  it('does not report a table fold for discarded active payload', () => {
    const result = htmlToCarve('<table><tr><td><code><script>x\ny</script>word</code></td></tr></table>')
    expect(result.report.diagnostics.map(d => d.code)).toEqual(['element-dropped'])
  })
  it('preserves code-span line breaks in AST table cells', () => {
    const result = htmlToAst('<table><tr><td><code>x\ny</code></td></tr></table>')
    expect(result.report.diagnostics).toEqual([])
    expect(JSON.stringify(result.value)).toContain('"value":"x\\ny"')
  })
  it('a code span line break in a pipe cell stays in the table and is reported', () => {
    const result = htmlToCarve('<table><tr><td><code>x\ny</code></td></tr></table>')
    expect(result.report.diagnostics.some(d => d.code === 'structure-unspellable')).toBe(true)
    expect(carveToHtml(result.value)).toContain('<td><code>x y</code></td>')
    expect(carveToCarve(result.value)).toBe(result.value)
  })
})
