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

  it('reports dropped phpBB quote user IDs at their source lines', () => {
    const source = 'intro\r\n[quote="alice" post_id=12 time=1700000000 user_id=3]q[/quote]\n[quote=user_id=4]r[/quote]'
    const result = migrateBbcode(source)
    expect(result.report.diagnostics.filter(row => row.code === 'bbcode-quote-user-id-dropped')).toEqual([
      expect.objectContaining({ path: 'line:2', fidelity: 'dropped', confidence: 'exact', severity: 'warning' }),
      expect.objectContaining({ path: 'line:3', fidelity: 'dropped', confidence: 'exact', severity: 'warning' }),
    ])
  })

  it('does not report user IDs in author names or literal BBCode content', () => {
    for (const source of [
      '[quote="Bob user_id=7"]x[/quote]',
      '[code][quote=user_id=7]x[/quote][/code]',
      '[c][quote=user_id=7]x[/icode]',
      '[noparse][quote=user_id=7]x[/quote][/noparse]',
    ]) {
      expect(migrateBbcode(source).report.diagnostics.some(row => row.code === 'bbcode-quote-user-id-dropped'), source).toBe(false)
    }
  })

  it('reports dropped user IDs inside links and images that the converter parses', () => {
    for (const source of [
      '[url=https://example.test][quote="alice" user_id=3]q[/quote][/url]',
      '[url][quote="alice" user_id=3]q[/quote][/url]',
      '[img][quote="alice" user_id=3]q[/quote][/img]',
    ]) {
      expect(migrateBbcode(source).report.diagnostics).toContainEqual(expect.objectContaining({
        code: 'bbcode-quote-user-id-dropped', path: 'line:1',
      }))
    }
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
    for (const source of ['<code>http://example.org</code>', '[^note]\n\n[^note]: note']) {
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
    const incomplete = migrateMarkdown('<code>http://example.org</code>\n\n1. [x] done\n')
    expect(incomplete.report.diagnostics.map(row => row.code)).toEqual(['fidelity-unverified', 'raw-code-fallback', 'structure-unspellable'])
  })
})
