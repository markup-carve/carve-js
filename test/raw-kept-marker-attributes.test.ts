import { describe, expect, it } from 'vitest'
import { htmlToCarve } from '../src/index.js'

describe('refused markers inside retained raw HTML', () => {
  it.each(['data-carve-src', 'data-djot-src'])('reports %s on the retained element', (name) => {
    const result = htmlToCarve(`<form ${name}="x" data-user="y">kept</form>`, { mode: 'roundtrip' })
    expect(result.value).toContain(`${name}="x"`)
    expect(result.report.diagnostics.filter(row => row.code === 'attribute-preserved')).toEqual([
      expect.objectContaining({ severity: 'info', path: '/form[1]',
        message: `Preserved round-trip marker attribute ${name} on <form> in the raw HTML this element is kept as` }),
    ])
  })

  it('reports the semantic key without reporting an ordinary attribute beside it', () => {
    const result = htmlToCarve('<form><cite cite="u" data-user="v">text</cite></form>', { mode: 'roundtrip' })
    expect(result.value).toContain('cite="u"')
    expect(result.report.diagnostics.filter(row => row.code === 'attribute-preserved')).toEqual([
      expect.objectContaining({ severity: 'info', path: '/form[1]/cite[1]',
        message: "Preserved cite on <cite> inside the raw HTML <form> is kept as: the semantic span's marker owns that key" }),
    ])
  })
  it('keeps denied marker values at error severity', () => {
    const result = htmlToCarve('<form data-carve-src="javascript:x()"><cite cite="javascript:y()">text</cite></form>', { mode: 'roundtrip' })
    expect(result.report.diagnostics.filter(row => row.code === 'attribute-preserved').map(row => row.severity)).toEqual(['error', 'error'])
  })

})
