import { describe, expect, it } from 'vitest'
import { fromAstJson, renderCarveWithConversionReport, renderHtml, carveToHtml } from '../src/index.js'
import cases from './fixtures/table-cell-break-conversion-reports.json'

describe('table-cell break conversion reports', () => {
  for (const item of cases) {
    it(item.name, () => {
      const ast = fromAstJson(item.ast)
      for (const maximum of [0, 1, 100]) {
        const result = renderCarveWithConversionReport(ast, {}, maximum)
        expect(result.report.totalDiagnostics).toBe(item.diagnostics.length)
        expect(result.report.truncated).toBe(item.diagnostics.length > maximum)
        expect(result.report.diagnostics.map(({ code, node, field }) => ({ code, node, ...(field ? { field } : {}) }))).toEqual(item.diagnostics.slice(0, maximum))
        expect(result.value).toBeDefined()
        const breaks = (html: string): number => (html.match(/<br(?:\s*\/?)?>/g) ?? []).length
        const lost = item.diagnostics.filter(d => d.node === 'hard_break').length
        expect(breaks(renderHtml(ast)) - breaks(carveToHtml(result.value!))).toBe(lost)
      }
    })
  }
})
