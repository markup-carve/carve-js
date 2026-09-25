import { describe, expect, it } from 'vitest'
import { migrateBbcode, migrateDjot, migrateHtml, migrateMarkdown } from '../src/index.js'

describe('shared migration result', () => {
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
    expect(outcomes).toEqual(['degraded', 'dropped', 'dropped', 'dropped'])
    expect(outcomes.every(outcome => ['preserved', 'normalized', 'degraded', 'dropped'].includes(outcome))).toBe(true)
  })

  it('does not claim a Djot rewrite was applied without importer evidence', () => {
    const result = migrateDjot('_emphasis_ and **strong**')
    expect(result.value).toBe('/emphasis/ and *strong*')
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
    for (const source of ['plain text', 'plain text\r\n\r\n', 'term\n: definition']) {
      expect(migrateMarkdown(source).report.diagnostics).toContainEqual(
        expect.objectContaining({ code: 'fidelity-unverified', fidelity: 'dropped', confidence: 'fallback' }),
      )
    }
  })

  it('reports an ordered task checkbox kept as text beside the incomplete-assessment row', () => {
    const result = migrateMarkdown('1. [x] done\n2. [ ] next\n')
    expect(result.value).toContain('1. [x] done')
    expect(result.report.diagnostics).toEqual([
      expect.objectContaining({ code: 'fidelity-unverified', fidelity: 'dropped', confidence: 'fallback' }),
      ...Array.from({ length: 2 }, () => expect.objectContaining({
        code: 'structure-unspellable',
        message: 'An ordered task item is not spellable as a Carve task item; the checkbox marker was kept as text',
        fidelity: 'dropped',
        confidence: 'exact',
      })),
    ])
    for (const source of ['- [x] done\n', '> 1. [x] done\n', '```\n1. [x] done\n```\n', 'para\n2. [x] done\n']) {
      expect(migrateMarkdown(source).report.diagnostics.map(({ code }) => code)).toEqual(['fidelity-unverified'])
    }
    for (const source of ['- a\n  1. [x] b\n', 'para\n1. [x] done\n', '1. [x] \n', '1. [x]\t\n']) {
      expect(migrateMarkdown(source).report.diagnostics.map(({ code }) => code)).toEqual([
        'fidelity-unverified', 'structure-unspellable',
      ])
    }
    for (const source of ['- 1. [x] b\n', '- a\n\n      1. [x] code\n', '1. [x]\n', '1.     [x] code\n', '- a\n\n  > 1. [x] b\n']) {
      expect(migrateMarkdown(source).report.diagnostics.map(({ code }) => code)).toEqual(['fidelity-unverified'])
    }
  })
})
