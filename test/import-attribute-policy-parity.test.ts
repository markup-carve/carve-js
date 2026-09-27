import { expect, it } from 'vitest'
import { htmlToCarve } from '../src/index.js'

it.each(['safe', 'semantic', 'roundtrip'] as const)('reports semantic marker collisions in %s mode', (mode) => {
  for (const tag of ['abbr', 'kbd', 'time', 'samp', 'var', 'cite', 'dfn']) {
    for (const value of ['', 'value', 'javascript:x()']) {
      const result = htmlToCarve(`<${tag} ${tag}="${value}">text</${tag}>`, { mode })
      const rows = result.report.diagnostics.filter((row) => row.code === 'attribute-dropped')
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ severity: 'warning', fidelity: 'dropped', confidence: 'exact', path: `/${tag}[1]` })
    }
  }
})

it.each(['safe', 'semantic'] as const)('reports ignored nested source markers in %s mode', (mode) => {
  for (const name of ['data-carve-src', 'data-djot-src']) {
    const rows = htmlToCarve(`<form><p ${name}="stored">text</p></form>`, { mode }).report.diagnostics
    expect(rows.filter((row) => row.code === 'attribute-dropped')).toMatchObject([
      { severity: 'info', fidelity: 'dropped', confidence: 'exact', path: '/form[1]/p[1]' },
    ])
  }
})

it.each(['align="right" style="text-align:left"', 'style="text-align:left" align="right"'])('reports a CSS-owned attribute inside kept bytes: %s', (attrs) => {
  const rows = htmlToCarve(`<form><table><tr><td ${attrs}>text</td></tr></table></form>`, { mode: 'roundtrip' }).report.diagnostics
  const align = rows.filter((row) => row.message.startsWith('Preserved align on <td>'))
  expect(align).toHaveLength(1)
  expect(align[0]).toMatchObject({ code: 'attribute-preserved', severity: 'info' })
})

it.each(['semantic', 'roundtrip'] as const)('reports CSS precedence in either attribute order in %s mode', (mode) => {
  for (const attrs of ['align="right" style="text-align:left"', 'style="text-align:left" align="right"']) {
    const result = htmlToCarve(`<p ${attrs}>text</p>`, { mode })
    expect(result.report.diagnostics.filter((row) => row.message.startsWith('Dropped align on <p>'))).toMatchObject([
      { code: 'attribute-dropped', severity: 'info', fidelity: 'dropped' },
    ])
    expect(result.value).toContain('align=left')
  }
})
