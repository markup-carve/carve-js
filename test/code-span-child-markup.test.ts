import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, htmlToCarve } from '../src/index.js'
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
  it('a code span line break in a pipe cell stays in the table and is reported', () => {
    const result = htmlToCarve('<table><tr><td><code>x\ny</code></td></tr></table>')
    expect(result.report.diagnostics.some(d => d.code === 'structure-unspellable')).toBe(true)
    expect(carveToHtml(result.value)).toContain('<td><code>x y</code></td>')
    expect(carveToCarve(result.value)).toBe(result.value)
  })
})
