import { describe, expect, it } from 'vitest'
import { carveToHtml, htmlToCarve } from '../src/index.js'

describe('HTML pre import loss reporting', () => {
  it('reports a newline added to a nonempty pre payload', () => {
    for (const html of ['<pre>tail</pre>', '<ul><li><pre>tail</pre></li></ul>']) {
      const result = htmlToCarve(html)
      expect(result.report.diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: 'structure-unspellable', message: expect.stringContaining('terminal newline') }),
      ]))
      expect(carveToHtml(result.value)).toContain('tail\n</code>')
    }
    expect(htmlToCarve('<pre>tail\n</pre>').report.diagnostics).toEqual([])
    expect(htmlToCarve('<pre></pre>').report.diagnostics).toEqual([])
  })
})
