import { describe, expect, it } from 'vitest'
import { assessTablePreservation, carveToPreservationReport, PreservationError, carveToAstJson, carveToMarkdownWithReport, migrateHtml } from '../src/index.js'

const html = '<table><caption>Limits</caption><tr><th>System</th><th colspan="2">Limit</th></tr><tr><td rowspan="2">A</td><td>Cold</td><td>20</td></tr><tr><td>Hot</td><td>10</td></tr></table>'
const source = migrateHtml(html).value

describe('table preservation assessment', () => {
  it('reports span and caption degradation separately from the normative render-loss channel', () => {
    expect(carveToMarkdownWithReport(source).totalLosses).toBe(0)
    const ast = carveToAstJson(source)
    const report = assessTablePreservation(ast, 'markdown')
    expect(report.diagnostics.map(d => d.field)).toEqual(['caption', 'colspan', 'rowspan'])
    expect(report.diagnostics[1]?.path).toBe('/children/0/rows/0/cells/1')
    expect(report.complete).toBe(false)
    expect(assessTablePreservation(ast, 'html').totalDiagnostics).toBe(0)
  })

  it('distinguishes ordinary GFM headers from extra headers and row headers', () => {
    const ast = carveToAstJson('|= A |= B |\n|= C |= D |\n|= E | F |\n')
    expect(assessTablePreservation(ast, 'markdown').diagnostics.filter(d => d.field === 'header')).toHaveLength(3)
    expect(assessTablePreservation(ast, 'plain').diagnostics.filter(d => d.field === 'header')).toHaveLength(5)
  })

  it('finds tables nested in footnotes and containers', () => {
    const ast = carveToAstJson('Text[^note].\n\n[^note]: |= A |\n    | B |\n    ^ nested\n')
    expect(assessTablePreservation(ast, 'markdown').diagnostics[0]?.path).toMatch(/^\/children\/\d+\/children\/0$/)
  })

  it('bounds detail without losing counts or weakening strict refusal', () => {
    const ast = carveToAstJson(source)
    const report = assessTablePreservation(ast, 'markdown', { maxDiagnostics: 0 })
    expect(report).toMatchObject({ totalDiagnostics: 3, diagnostics: [], truncated: true })
    expect(() => assessTablePreservation(ast, 'markdown', { strictPreservation: true, maxDiagnostics: 0 })).toThrow(PreservationError)
    expect(() => assessTablePreservation(ast, 'markdown', { maxDiagnostics: -1 })).toThrow(RangeError)
  })
})


it('offers a checked output API without changing the render-loss schema', () => {
  const result = carveToPreservationReport(source, 'markdown')
  expect(result).toMatchObject({ totalLosses: 0, preservation: { totalDiagnostics: 3 } })
  expect(() => carveToPreservationReport(source, 'markdown', { strictPreservation: true })).toThrow(PreservationError)
  expect(carveToPreservationReport(source, 'html', { strictPreservation: true }).value).toContain('colspan="2"')
})


it('normalizes span markers and assesses header order and effective alignment', () => {
  const ast = carveToAstJson(source) as any
  delete ast.children[0].rows[0].cells[1].colspan
  expect(assessTablePreservation(ast, 'markdown').diagnostics.some(d => d.field === 'colspan')).toBe(true)
  const moved = assessTablePreservation(carveToAstJson('| 1 | 2 |\n|= A |= B |\n'), 'markdown')
  expect(moved.diagnostics.map(d => d.field)).toContain('rowOrder')
  const aligned = assessTablePreservation(carveToAstJson('|=> A |= B |\n|=< C |= D |\n| 1 | 2 |\n'), 'markdown')
  expect(aligned.diagnostics.map(d => d.field)).toContain('align')
  expect(assessTablePreservation(carveToAstJson('|> 1 | 2 |\n| 3 | 4 |\n'), 'markdown').diagnostics.some(d => d.field === 'align')).toBe(true)
  expect(assessTablePreservation(carveToAstJson('|= A |= B |\n| 1 | 2 |\n'), 'ansi').totalDiagnostics).toBe(0)
})


it('checks inherited alignment when a late header changes the GFM column default', () => {
  const report = assessTablePreservation(carveToAstJson('|=> A |\n| 1 |\n|=< B |\n'), 'markdown')
  expect(report.diagnostics).toContainEqual(expect.objectContaining({ path:'/children/0/rows/1/cells/0', field:'align' }))
})


it('skips span markers and treats left as the default text alignment', () => {
  const merged = assessTablePreservation(carveToAstJson('|=> A | < |= C |\n| 1 | 2 | 3 |\n'), 'markdown')
  expect(merged.diagnostics.some(d => d.path === '/children/0/rows/0/cells/1')).toBe(false)
  for (const target of ['plain', 'ansi'] as const) {
    const report = assessTablePreservation(carveToAstJson('|< A |\n| 1 |\n'), target)
    expect(report.diagnostics.filter(d => d.field === 'align')).toHaveLength(0)
  }
})
