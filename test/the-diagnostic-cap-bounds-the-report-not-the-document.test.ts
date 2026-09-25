import { describe, it, expect } from 'vitest'
import { HtmlImportLimitError, htmlToAst, htmlToCarve } from '../src/index.js'
import { HTML_IMPORT_DIAGNOSTIC_CODES } from '../src/html-import.js'

/**
 * `diagnostics-truncated` was declared in the code list and emitted nowhere: the
 * cap threw `HtmlImportLimitError('diagnostics')`, so the code was a promise no
 * import could keep and a consumer branching on it had written dead code
 * (carve-js#2034).
 *
 * The cap bounds the REPORT rather than the document. What it turns away is a
 * row, not a node, so refusing threw away a conversion that had already
 * succeeded. PART 9 lets a diagnostic cap replace its last entry with the
 * `diagnostics-truncated` row instead, which is the shape carve-rs writes, so
 * this also closes a divergence a consumer could not write one handler for.
 *
 * `maxDepth` and `maxNodes` still throw. Those bound the DOCUMENT, and past
 * either one the output would be a fragment of what was asked for.
 */
const OVER_CAP = '<p onclick="x()">x</p><p onmouseover="y()">y</p>'

describe('the diagnostic cap', () => {
  it('hands back the converted document and says the report is short', () => {
    const result = htmlToCarve(OVER_CAP, { maxDiagnostics: 1 })
    // The conversion is COMPLETE: both paragraphs are there.
    expect(result.value).toBe('x\n\ny\n')
    expect(result.report.diagnostics).toEqual([{
      code: 'diagnostics-truncated',
      message: 'HTML import diagnostics limit reached',
      severity: 'error',
      fidelity: 'dropped',
      confidence: 'fallback',
    }])
  })

  it('replaces its last row rather than adding one, so the cap stays a bound', () => {
    const three = '<p onclick="a()">a</p><p onclick="b()">b</p><p onclick="c()">c</p>'
    const rows = htmlToCarve(three, { maxDiagnostics: 2 }).report.diagnostics
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ code: 'attribute-dropped', message: expect.stringContaining('onclick') })
    expect(rows.at(-1)?.code).toBe('diagnostics-truncated')
  })

  it('puts the row LAST, behind every row that has a place in the document', () => {
    // The marker reports the state of the report rather than a loss at a place,
    // so it has no element to be ordered by.
    const rows = htmlToCarve('<div style="color:red"><p onclick="x()">x</p></div><script>y()</script>', {
      maxDiagnostics: 2,
    }).report.diagnostics
    expect(rows.at(-1)?.code).toBe('diagnostics-truncated')
    expect(rows.slice(0, -1).map((row) => row.code)).not.toContain('diagnostics-truncated')
  })

  it('is the whole report where the cap is zero', () => {
    // There is no row to replace, and a truncated report has to be able to say
    // it is truncated.
    const result = htmlToAst('<p onclick="x()">x</p>', { maxDiagnostics: 0 })
    expect(result.value.children).toHaveLength(1)
    expect(result.report.diagnostics.map((row) => row.code)).toEqual(['diagnostics-truncated'])
  })

  it('reaches a serialization loss the writer finds after the walk', () => {
    const figure = '<figure><table><tr><td>1</td></tr></table><figcaption>Cap</figcaption></figure>'
    const result = htmlToCarve(figure, { maxDiagnostics: 0 })
    expect(result.value).toContain('Cap')
    expect(result.report.diagnostics.map((row) => row.code)).toEqual(['diagnostics-truncated'])
  })

  it('does not count the rows a discarded walk recorded', () => {
    // `roundtrip` walks a figure whose target cannot carry the caption, then
    // rewinds and keeps the element raw. The walk's rows are claims about bytes
    // the output still carries, so its cap hits are discarded with them - left
    // standing, the marker replaced the one row the report does keep and a
    // document under the cap came back saying it was over it.
    const figure =
      '<figure><ul><li style="color:red;font-weight:bold;letter-spacing:1px">x</li></ul><figcaption>Cap</figcaption></figure>'
    for (const maxDiagnostics of [1, 2, 3, 5]) {
      const result = htmlToCarve(figure, { mode: 'roundtrip', maxDiagnostics })
      expect(result.report.diagnostics.map((row) => row.code)).toEqual(['raw-preserved'])
      expect(result.report.diagnostics[0]?.message).toContain('<figure>')
    }
    // A cap of zero turns the kept row itself away, and there the marker is right.
    expect(htmlToCarve(figure, { mode: 'roundtrip', maxDiagnostics: 0 }).report.diagnostics.map((row) => row.code))
      .toEqual(['diagnostics-truncated'])
  })

  it('reaches a refused attribute on an element kept raw', () => {
    // `attribute-preserved` is promoted from a latent row, which is the other
    // place the cap is asked. Past it the row stays latent and out of the
    // report, and the marker stands for it.
    const result = htmlToCarve('<form><a href="javascript:x">t</a></form>', { mode: 'roundtrip', maxDiagnostics: 1 })
    expect(result.value).toContain('<form')
    expect(result.report.diagnostics.map((row) => row.code)).toEqual(['diagnostics-truncated'])
  })
})

describe('what already held still holds', () => {
  // Controls: each of these passes on BOTH sides of the change.
  it('still throws on the node limit, which bounds the document', () => {
    expect(() => htmlToAst('<p>x</p>', { maxNodes: 1 })).toThrow(HtmlImportLimitError)
    expect(() => htmlToAst('<p>x</p>', { maxNodes: 1 })).toThrow(/nodes limit/)
  })

  it('still throws on the depth limit', () => {
    const deep = '<div>'.repeat(200) + 'x'
    expect(() => htmlToAst(deep, { maxDepth: 4 })).toThrow(HtmlImportLimitError)
    expect(() => htmlToAst(deep, { maxDepth: 4 })).toThrow(/depth limit/)
  })

  it('leaves a report under the cap untouched', () => {
    const rows = htmlToCarve(OVER_CAP).report.diagnostics
    expect(rows.map((row) => row.code)).toEqual(['attribute-dropped', 'attribute-dropped'])
    expect(rows.map((row) => row.message)).toEqual([
      'Dropped event-handler attribute onclick on <p>',
      'Dropped event-handler attribute onmouseover on <p>',
    ])
  })

  it('leaves a report exactly AT the cap untouched', () => {
    const rows = htmlToCarve(OVER_CAP, { maxDiagnostics: 2 }).report.diagnostics
    expect(rows.map((row) => row.code)).toEqual(['attribute-dropped', 'attribute-dropped'])
  })
})

/**
 * The producer gate, run over the WHOLE code list rather than the one entry the
 * ticket named. A declared name nothing produces is a class, not an instance,
 * and the list is the published schema's enum, so a consumer reads it as what a
 * report may carry.
 *
 * The spec exempted `diagnostics-truncated` from the fixture gate because no
 * fixture reaches a cap. A cap is reachable from an option, so the exemption is
 * not needed here.
 */
describe('every declared diagnostic code has a producer in this engine', () => {
  const produces: ReadonlyArray<readonly [string, string, Parameters<typeof htmlToCarve>[1]]> = [
    ['element-dropped', '<script>x()</script>', {}],
    ['element-unwrapped', '<p><x-unsupported>x</x-unsupported></p>', {}],
    ['attribute-dropped', '<p onclick="x()">x</p>', {}],
    ['attribute-preserved', '<form><a href="javascript:x">t</a></form>', { mode: 'roundtrip' }],
    ['style-unmapped', '<div style="color:red">x</div>', {}],
    ['table-degraded', '<table><caption>A</caption><caption>B</caption><tr><td>1</td></tr></table>', {}],
    ['structure-unspellable', '<figure><table><tr><td>1</td></tr></table><figcaption>Cap</figcaption></figure>', {}],
    ['raw-preserved', '<p><x-unsupported>x</x-unsupported></p>', { mode: 'roundtrip' }],
    ['encoding-assumed', '<p><math alttext="x^2"></math></p>', {}],
    ['diagnostics-truncated', '<p onclick="x()">x</p>', { maxDiagnostics: 0 }],
  ]

  it.each(produces)('%s is emitted by an input this engine accepts', (code, html, options) => {
    const rows = htmlToCarve(html, options).report.diagnostics
    expect(rows.map((row) => row.code)).toContain(code)
    // Element plus text: the row carries a message a reader can act on, not
    // only a code.
    expect(rows.find((row) => row.code === code)?.message).not.toBe('')
  })

  it('covers every code the list declares, so a new orphan fails here', () => {
    expect([...HTML_IMPORT_DIAGNOSTIC_CODES].sort()).toEqual(produces.map(([code]) => code).sort())
  })
})
