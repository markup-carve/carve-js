import { describe, expect, it } from 'vitest'
import { fromAstJson, renderCarveWithConversionReport, renderHtml, carveToHtml } from '../src/index.js'
import cases from './fixtures/table-cell-break-conversion-reports.json'

describe('table-cell break conversion reports', () => {
  for (const item of cases) {
    it(item.name, () => {
      const ast = fromAstJson(item.ast)
      // The trailing fixture predates carve#3735; its break now has a source spelling.
      const expected = item.name === 'trailing' ? [] : item.diagnostics
      for (const maximum of [0, 1, 100]) {
        const result = renderCarveWithConversionReport(ast, {}, maximum)
        expect(result.report.totalDiagnostics).toBe(expected.length)
        expect(result.report.truncated).toBe(expected.length > maximum)
        expect(result.report.diagnostics.map(({ code, node, field }) => ({ code, node, ...(field ? { field } : {}) }))).toEqual(expected.slice(0, maximum))
        expect(result.value).toBeDefined()
        const breaks = (html: string): number => (html.match(/<br(?:\s*\/?)?>/g) ?? []).length
        const lost = expected.filter(d => d.node === 'hard_break').length
        expect(breaks(renderHtml(ast)) - breaks(carveToHtml(result.value!))).toBe(lost)
      }
    })
  }
})
