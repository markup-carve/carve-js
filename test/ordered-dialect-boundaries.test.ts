import { describe, expect, it } from 'vitest'
import cases from './fixtures/ordered-dialect-boundaries.json'
import { carveToCarve, carveToHtml, htmlToCarve } from '../src/index.js'

describe('an ordered dialect cannot cross a hard list boundary', () => {
  for (const row of cases) {
    it(row.name, () => {
      expect(carveToHtml(row.source)).toBe(row.html)
      expect(carveToCarve(row.source)).toBe(row.source)
      const imported = htmlToCarve(row.inputHtml)
      expect(imported.value).toBe(row.source)
      expect(imported.report.diagnostics).toEqual([])
      expect(carveToHtml(imported.value)).toBe(row.html)
    })
  }
  it('three blanks inside the item body do not end the sibling search', () => {
    expect(carveToHtml('x. one\n\n\n\n   body\n\nxi. two\n')).toContain('<ol type="i" start="10">')
  })
  it('two blank lines still permit the sibling tie-break', () => {
    expect(carveToHtml('v. x\n\n\nvi. y\n')).toContain('<ol type="i" start="5">')
  })
})
