import { describe, expect, it } from 'vitest'
import { migrateBbcode, migrateDjot, migrateHtml, migrateMarkdown } from '../src/index.js'

describe('shared migration result', () => {
  it('verifies complete literal-text inputs and leaves syntax outside that coverage unverified', () => {
    const importers = [migrateMarkdown, migrateDjot, migrateBbcode]
    for (const migrate of importers) {
      for (const source of ['', 'hello', 'plain text', 'Grüße 123', '日本語', 'hello\r\n\r\n']) {
        expect(migrate(source).report.diagnostics).toEqual([
          expect.objectContaining({ code: 'literal-text-verified', fidelity: 'preserved', confidence: 'exact', severity: 'info' }),
        ])
      }
      if (migrate === migrateMarkdown) continue
      for (const source of ['# heading', '*bold*', '[b]text[/b]', 'a\nb', '    code', '1. item', 'a  b', 'a\tb', 'hello!', ' hello', 'hello ', 'a\u00a0b', 'e\u0301', 'a\r\nb', 'a\rb']) {
        expect(migrate(source).report.diagnostics).toContainEqual(expect.objectContaining({ code: 'fidelity-unverified', fidelity: 'dropped' }))
      }
    }
  })

  it('uses one result shape for every source format', () => {
    expect(migrateMarkdown('**strong**')).toMatchObject({
      value: '*strong*',
      report: { schemaVersion: 2, sourceFormat: 'markdown' },
    })
    expect(migrateDjot('_emphasis_')).toMatchObject({
      value: '/emphasis/',
      report: { schemaVersion: 2, sourceFormat: 'djot' },
    })
    expect(migrateHtml('<p>text</p>')).toMatchObject({
      value: 'text\n',
      report: { schemaVersion: 2, sourceFormat: 'html' },
    })
    expect(migrateBbcode('[b]strong[/b]')).toMatchObject({
      value: '*strong*\n',
      report: { schemaVersion: 2, sourceFormat: 'bbcode' },
    })
  })

  it('uses the shared four-state fidelity vocabulary', () => {
    const outcomes = [
      migrateHtml('<section><p>x</p></section>').report.diagnostics,
      migrateMarkdown('**strong**').report.diagnostics,
      migrateDjot('_emphasis_').report.diagnostics,
      migrateBbcode('[b]strong[/b]').report.diagnostics,
    ].flat().map(diagnostic => diagnostic.fidelity)
    expect(outcomes).toEqual(['degraded', 'preserved', 'preserved', 'dropped', 'dropped'])
    expect(outcomes.every(outcome => ['preserved', 'normalized', 'degraded', 'dropped'].includes(outcome))).toBe(true)
  })

  it('does not claim a Djot rewrite was applied without importer evidence', () => {
    const result = migrateDjot('_emphasis_ and **strong**')
    expect(result.value).toBe('/emphasis/ and {*{*strong*}*}')
    // The repeated strong wrapper has a spelling since carve#2877, so the
    // fallback claim is the only diagnostic left.
    expect(result.report.diagnostics).toEqual([
      expect.objectContaining({ code: 'fidelity-unverified', fidelity: 'dropped', confidence: 'fallback' }),
    ])
  })

  it('classifies HTML losses', () => {
    const result = migrateHtml('<p><kbd kbd=lit>text</kbd></p>')
    expect(result.report.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'attribute-dropped', fidelity: 'dropped', confidence: 'exact' }),
    )
    expect(migrateHtml('<ruby>x<rt>y</rt></ruby>').report.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'structure-unspellable', fidelity: 'dropped', confidence: 'exact' }),
    )
  })

  it('does not mistake byte equality or whitespace rewrites for verified fidelity', () => {
    for (const source of ['https://example.org', '[^note]\n\n[^note]: note']) {
      expect(migrateMarkdown(source).report.diagnostics).toContainEqual(
        expect.objectContaining({ code: 'fidelity-unverified', fidelity: 'dropped', confidence: 'fallback' }),
      )
    }
  })

  it('reports ordered task losses after complete assessment', () => {
    const result = migrateMarkdown('1. [x] done\n2. [ ] next\n')
    expect(result.value).toContain('1. [x] done')
    expect(result.report.diagnostics.filter(row => row.fidelity === 'dropped')).toEqual([
      expect.objectContaining({ code: 'structure-unspellable', confidence: 'exact', path: 'line:1' }),
      expect.objectContaining({ code: 'structure-unspellable', confidence: 'exact', path: 'line:2' }),
    ])
    expect(result.report.diagnostics.some(row => row.code === 'fidelity-unverified')).toBe(false)
    const incomplete = migrateMarkdown('https://example.org\n\n1. [x] done\n')
    expect(incomplete.report.diagnostics.map(row => row.code)).toEqual(['fidelity-unverified', 'structure-unspellable'])
  })
})
