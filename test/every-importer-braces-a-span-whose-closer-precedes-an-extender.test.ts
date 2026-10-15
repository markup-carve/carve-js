import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
import { migrateBbcode, migrateDjot, migrateMarkdown } from '../src/migration.js'

// carve-js#3150: a bare closer directly before a grapheme extender is part of
// a larger character (CARVE-P3-025), so the importers brace the span, as the
// HTML importer and the canonical writer already do.
const EXTENDERS = ['\u0301', '\uFE0F', '\u093E', '\u{E0100}']

const importers: Array<[string, (input: string) => string, string, string]> = [
  ['Markdown', (input) => migrateMarkdown(input).value, 'x **a**#', 'x <sup>a</sup>#'],
  ['Djot', (input) => migrateDjot(input).value, 'x *a*#', 'x {^a^}#'],
  ['BBCode', (input) => migrateBbcode(input).value, 'x [b]a[/b]#', 'x [sup]a[/sup]#'],
]

describe('a span whose closer would sit before a grapheme extender', () => {
  for (const [name, run, strong, sup] of importers) {
    describe(name, () => {
      for (const extender of EXTENDERS) {
        it(`braces it (U+${extender.codePointAt(0)!.toString(16).toUpperCase()})`, () => {
          const value = run(strong.replace('#', extender))
          expect(value.trimEnd()).toBe(`x {*a*}${extender}`)
          expect(carveToHtml(value).trimEnd()).toBe(`<p>x <strong>a</strong>${extender}</p>`)
        })
      }

      it('keeps a superscript, which is braced already', () => {
        expect(carveToHtml(run(sup.replace('#', '\u0301'))).trimEnd()).toBe('<p>x <sup>a</sup>\u0301</p>')
      })

      it('leaves a closer before ordinary text bare', () => {
        expect(run(strong.replace('#', ' y')).trimEnd()).toBe('x *a* y')
      })
    })
  }

  it('reads a Markdown character reference after the closer', () => {
    expect(carveToHtml(migrateMarkdown('x **a**&#x301; y').value).trimEnd()).toBe('<p>x <strong>a</strong>\u0301 y</p>')
  })

  it('braces the outer BBCode span that ends before the extender', () => {
    expect(carveToHtml(migrateBbcode('x [b][i]a[/i][/b]\u0301').value).trimEnd()).toBe('<p>x <strong><em>a</em></strong>\u0301</p>')
  })

  it('braces a Markdown inline HTML tag form too', () => {
    expect(migrateMarkdown('x <strong>a</strong>\u0301').value.trimEnd()).toBe('x {*a*}\u0301')
    expect(migrateMarkdown('x <del>a</del>\u0301').value.trimEnd()).toBe('x {~a~}\u0301')
  })
})
