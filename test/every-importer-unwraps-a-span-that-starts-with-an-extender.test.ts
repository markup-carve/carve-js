import { describe, expect, it } from 'vitest'
import { carveToHtml, htmlToCarve } from '../src/index.js'
import { migrateBbcode, migrateDjot, migrateMarkdown } from '../src/migration.js'
import { EXTENDER_LEADING_SPAN_UNSPELLABLE } from '../src/import/markdown/import-report-messages.js'

// carve-js#3146: after CARVE-P3-025 a span whose content starts with a grapheme
// extender has no Carve spelling. Every importer drops the span, keeps its
// text and reports the same diagnostic.
const ACUTE = '\u0301'
const SPACING = '\u093E'

const report = (rows: readonly { code: string; message: string }[]) =>
  rows.filter(row => row.message === EXTENDER_LEADING_SPAN_UNSPELLABLE).map(row => row.code)

const importers: Array<[string, (mark: string) => { value: string; codes: string[] }, Record<string, string>]> = [
  ['HTML', (input) => { const r = htmlToCarve(input); return { value: r.value, codes: report(r.report.diagnostics) } },
    { strong: '<p><strong>#bold</strong></p>', em: '<p>a <em>#x</em> b</p>', sup: '<p>E<sup>#2</sup></p>', nested: '<p><strong><em>#x</em></strong></p>' }],
  ['Markdown', (input) => { const r = migrateMarkdown(input); return { value: r.value, codes: report(r.report.diagnostics) } },
    { strong: '**#bold**', em: 'a _#x_ b', sup: 'E<sup>#2</sup>', nested: '***#x***' }],
  ['Djot', (input) => { const r = migrateDjot(input); return { value: r.value, codes: report(r.report.diagnostics) } },
    { strong: '*#bold*', em: 'a _#x_ b', sup: 'E{^#2^}', nested: '*_#x_*' }],
  ['BBCode', (input) => { const r = migrateBbcode(input); return { value: r.value, codes: report(r.report.diagnostics) } },
    { strong: '[b]#bold[/b]', em: 'a [i]#x[/i] b', sup: 'E[sup]#2[/sup]', nested: '[b][i]#x[/i][/b]' }],
]

describe('a span whose content starts with a grapheme extender', () => {
  for (const [name, run, inputs] of importers) {
    describe(name, () => {
      for (const extender of [ACUTE, SPACING]) {
        it(`drops the span and keeps the text (U+${extender.codePointAt(0)!.toString(16).toUpperCase()})`, () => {
          const { value, codes } = run(inputs.strong!.replace('#', extender))
          expect(value.trimEnd()).toBe(`${extender}bold`)
          expect(carveToHtml(value).trimEnd()).toBe(`<p>${extender}bold</p>`)
          expect(codes).toEqual(['structure-unspellable'])
        })
      }

      it('handles emphasis and superscript the same way', () => {
        const em = run(inputs.em!.replace('#', ACUTE))
        expect(carveToHtml(em.value).trimEnd()).toBe(`<p>a ${ACUTE}x b</p>`)
        expect(em.codes).toEqual(['structure-unspellable'])
        const sup = run(inputs.sup!.replace('#', ACUTE))
        expect(carveToHtml(sup.value).trimEnd()).toBe(`<p>E${ACUTE}2</p>`)
        expect(sup.codes).toEqual(['structure-unspellable'])
      })

      it('drops an outer span the inner drop leaves starting with the extender', () => {
        const { value, codes } = run(inputs.nested!.replace('#', ACUTE))
        expect(carveToHtml(value).trimEnd()).toBe(`<p>${ACUTE}x</p>`)
        expect(codes.length).toBeGreaterThan(0)
        expect(new Set(codes)).toEqual(new Set(['structure-unspellable']))
      })

      it('keeps a span whose extender is not at the start', () => {
        const { value, codes } = run(inputs.strong!.replace('#', `a${ACUTE}`))
        expect(carveToHtml(value).trimEnd()).toBe(`<p><strong>a${ACUTE}bold</strong></p>`)
        expect(codes).toEqual([])
      })
    })
  }

  it('reads a character reference the way the reader will decode it', () => {
    for (const input of ['**&#x301;bold**', '<strong>&#769;bold</strong>']) {
      const { value, report: { diagnostics } } = migrateMarkdown(input)
      expect(carveToHtml(value).trimEnd(), input).toBe(`<p>${ACUTE}bold</p>`)
      expect(report(diagnostics), input).toEqual(['structure-unspellable'])
    }
    const html = htmlToCarve('<p><strong>&#x301;bold</strong></p>')
    expect(html.value).toBe(`${ACUTE}bold\n`)
    expect(report(html.report.diagnostics)).toEqual(['structure-unspellable'])
  })
})
