import { describe, it, expect } from 'vitest'
import { applyMigrationFixes, djotMigrationWarnings } from '../src/djot-migrate.js'
import { carveToHtml } from '../src/index.js'

/**
 * Djot spells subscript braced as well as bare and means the same by each, so
 * `{~x~}` has to convert like `~x~`. The bare rule matched INSIDE the braces
 * while its suggestion carried its own, so the fix spliced `{,y,}` over `~y~`
 * and left the source's braces standing: `{{,y,}}`, rendering the stray
 * literal braces `{<sub>y</sub>}`.
 */
describe("Djot's braced subscript converts as one edit", () => {
  it('rewrites {~y~} to {,y,} rather than doubling the braces', () => {
    expect(applyMigrationFixes('{~y~} a\n').output).toBe('{,y,} a\n')
  })

  it('renders what Djot meant, with no literal braces left over', () => {
    const fixed = applyMigrationFixes('{~y~} a\n').output
    expect(carveToHtml(fixed).trim()).toBe('<p><sub>y</sub> a</p>')
  })

  it('reports the braced form once, under its own rule', () => {
    const w = djotMigrationWarnings('{~y~} a')
    expect(w.map((x) => x.rule)).toEqual(['djot-subscript-tilde-braced'])
    expect(w[0]!.suggestion).toBe('{,y,}')
  })

  /**
   * BOUND, not proof: the bare and intraword forms already worked and do not
   * move under this change. Removing the new rule breaks the three cases above
   * and leaves these passing, so they bound the fix rather than prove it.
   */
  it('leaves the bare and intraword subscript alone', () => {
    expect(applyMigrationFixes('~y~ a\n').output).toBe('{,y,} a\n')
    expect(applyMigrationFixes('H~2~O\n').output).toBe('H{,2,}O\n')
  })

  /**
   * BOUND: the superscript pair is the case this must NOT be copied onto.
   * `{^x^}` is valid Carve as-is, so it stays untouched, while the bare form
   * still needs the braces added.
   */
  it('does not disturb the superscript rules', () => {
    expect(applyMigrationFixes('{^x^} a\n').output).toBe('{^x^} a\n')
    expect(applyMigrationFixes('^x^ a\n').output).toBe('{^x^} a\n')
  })

  /**
   * BOUND: `~~x~~` is Markdown strikethrough and is claimed by the
   * double-tilde rule before either subscript rule sees it.
   */
  it('leaves Markdown strikethrough to its own rule', () => {
    expect(applyMigrationFixes('~~s~~ a\n').output).toBe('~s~ a\n')
  })
})
