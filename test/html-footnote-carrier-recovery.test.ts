import { describe, expect, it } from 'vitest'
import { htmlToAst, htmlToCarve } from '../src/index.js'
import type { HtmlImportMode } from '../src/html-import.js'
import fixtures from './fixtures/footnote-carrier-recovery-fixtures.json'

function authoredAttributeNames(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(authoredAttributeNames)
  if (typeof value !== 'object' || value === null) return []
  const record = value as Record<string, unknown>
  const attrs = record.attrs as { keyValues?: Record<string, string> } | undefined
  const names = Object.keys(attrs?.keyValues ?? {})
  return names.concat(Object.values(record).flatMap(authoredAttributeNames))
}

describe('footnote carrier recovery (carve#2918)', () => {
  for (const fixture of fixtures) {
    it(fixture.name, () => {
      const options = { mode: fixture.mode as HtmlImportMode }
      const result = htmlToCarve(fixture.html, options)
      expect(result.value).toBe(fixture.expectedSource)
      expect(result.report.diagnostics.map(({ code, severity, fidelity, confidence }) => ({
        code, severity, fidelity, confidence,
      }))).toEqual(fixture.expectedDiagnostics)
      const attributes = authoredAttributeNames(htmlToAst(fixture.html, options).value)
      for (const name of fixture.forbiddenAuthoredAttributes) {
        expect(attributes).not.toContain(name)
        expect(result.value).not.toContain(name)
      }
    })
  }

  for (const mode of ['safe', 'semantic', 'roundtrip'] as const) {
    for (const prefix of ['data-carve', 'data-djot']) {
      it(`${mode} ${prefix} contradictory endnotes retain numbered notes with reference metadata`, () => {
        const html = `<p><a href="#fn1" role="doc-noteref" ${prefix}-footnote-label="named">1</a></p>`
          + `<section role="doc-endnotes"><ol><li id="fn1" role="doc-endnote" ${prefix}-footnote-label="named" ${prefix}-inline-footnote="1"><p>body</p></li></ol></section>`
        const result = htmlToCarve(html, { mode })
        expect(result.value).toBe('[^1]\n\n[^1]: body\n')
        expect(result.report.diagnostics.map(({ code, severity, fidelity, confidence }) => ({
          code, severity, fidelity, confidence,
        }))).toEqual([{
          code: 'attribute-dropped', severity: 'warning', fidelity: 'dropped', confidence: 'exact',
        }])
        const attributes = authoredAttributeNames(htmlToAst(html, { mode }).value)
        expect(attributes).not.toContain(`${prefix}-footnote-label`)
        expect(attributes).not.toContain(`${prefix}-inline-footnote`)
      })
    }
  }
  for (const mode of ['safe', 'semantic', 'roundtrip'] as const) {
    for (const prefix of ['data-carve', 'data-djot']) {
      for (const label of ['', 'bad]label', 'a]: body', 'a]: `<script>`{=html}', 'line&#10;label', 'line&#13;label', 'line&#x2028;label', 'line&#x2029;label']) {
        for (const inline of [false, true]) {
          it(`${mode} ${prefix} drops invalid label ${JSON.stringify(label)} with inline=${inline}`, () => {
            const html = '<p><a href="#fn1" role="doc-noteref">1</a></p>'
              + `<section role="doc-endnotes"><ol><li id="fn1" role="doc-endnote" ${prefix}-footnote-label="${label}"${inline ? ` ${prefix}-inline-footnote="1"` : ''}><p>body</p></li></ol></section>`
            const result = htmlToCarve(html, { mode })
            expect(result.value).toBe(inline ? '^[body]\n' : '[^1]\n\n[^1]: body\n')
            expect(result.report.diagnostics.map(({ code, severity, fidelity, confidence }) => ({
              code, severity, fidelity, confidence,
            }))).toEqual([{
              code: 'attribute-dropped', severity: 'warning', fidelity: 'dropped', confidence: 'exact',
            }])
            const attributes = authoredAttributeNames(htmlToAst(html, { mode }).value)
            for (const name of fixtures[0]!.forbiddenAuthoredAttributes) expect(attributes).not.toContain(name)
          })
        }
      }
    }
  }

  for (const mode of ['safe', 'semantic', 'roundtrip'] as const) {
    for (const inline of [false, true]) {
      it(`${mode} rejects an invalid canonical label before a legacy label, inline=${inline}`, () => {
        const html = '<p><a href="#fn1" role="doc-noteref">1</a></p>'
          + `<section role="doc-endnotes"><ol><li id="fn1" data-carve-footnote-label="bad]label" data-djot-footnote-label="named"${inline ? ' data-djot-inline-footnote="1"' : ''}><p>body</p></li></ol></section>`
        const result = htmlToCarve(html, { mode })
        expect(result.value).toBe(inline ? '^[body]\n' : '[^1]\n\n[^1]: body\n')
        expect(result.report.diagnostics.map(({ code, severity, fidelity, confidence }) => ({
          code, severity, fidelity, confidence,
        }))).toEqual([{
          code: 'attribute-dropped', severity: 'warning', fidelity: 'dropped', confidence: 'exact',
        }])
        const attributes = authoredAttributeNames(htmlToAst(html, { mode }).value)
        for (const name of fixtures[0]!.forbiddenAuthoredAttributes) expect(attributes).not.toContain(name)
      })
    }
    it(`${mode} retains both references to a note with an invalid label and an inline flag`, () => {
      const html = '<p><a href="#fn1" role="doc-noteref">1</a> <a href="#fn1" role="doc-noteref">1</a></p>'
        + '<section role="doc-endnotes"><ol><li id="fn1" data-carve-footnote-label="bad]label" data-carve-inline-footnote="1"><p>body</p></li></ol></section>'
      const result = htmlToCarve(html, { mode })
      expect(result.value).toBe('[^1] [^1]\n\n[^1]: body\n')
      expect(result.report.diagnostics.map(({ code }) => code)).toEqual(['attribute-dropped'])
    })
  }

})
