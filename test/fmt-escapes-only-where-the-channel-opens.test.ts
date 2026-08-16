import { describe, it, expect } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

/*
 * Two escapes this writer wrote for channels the character cannot open, both
 * measured against carve-php and carve-rs, which write the bare form.
 *
 * A cell's ATTRIBUTE BLOCK ends the parser's alignment scan: PART 9 §319 binds
 * attributes after the kind and alignment markers, so nothing past `}` reads as
 * a marker. The separator space that guards a glued sigil is therefore only
 * needed when the prefix is a bare `=` or nothing at all.
 *
 * A TAB after a caption caret leaves the line as prose (corpus 231), so `^` in
 * that position opens no caption and needs no backslash. Corpus 304 states the
 * rule these two share: a character is escaped only where it opens markup.
 */
describe('fmt escapes only where the channel actually opens', () => {
  it('an attributed cell whose content opens with an alignment sigil stays glued', () => {
    const src = '|{#x}< content |\n'
    expect(carveToCarve(src)).toBe('|{#x}< content|\n')
    expect(carveToHtml(carveToCarve(src))).toBe(carveToHtml(src))
  })

  it('the same holds for the right and center sigils', () => {
    expect(carveToCarve('|{#x}>b|\n')).toBe('|{#x}>b|\n')
    expect(carveToCarve('|={#x}~x~|\n')).toBe('|={#x}~x~|\n')
    expect(carveToHtml(carveToCarve('|={#x}~x~|\n'))).toBe(carveToHtml('|={#x}~x~|\n'))
  })

  it('an UNATTRIBUTED prefixed cell still takes the separator space', () => {
    // The guard this narrows: after a bare `=` the scan does run, and `~x~`
    // glued to it reads as center alignment with the text `x~`.
    expect(carveToCarve('|= ~x~ |\n')).toBe('|= ~x~|\n')
    expect(carveToHtml(carveToCarve('|= ~x~ |\n'))).toBe(carveToHtml('|= ~x~ |\n'))
  })

  it('a caret before a tab is written bare', () => {
    const src = '![Moon](m.jpg)\n^\tFigure 1\n'
    expect(carveToCarve(src)).toBe('![Moon](m.jpg)\n^\tFigure 1\n')
    expect(carveToHtml(carveToCarve(src))).toBe(carveToHtml(src))
  })

  it('a caret before a SPACE still opens a caption and stays escaped', () => {
    // A captioned table already holds its caption, so the paragraph after it
    // would re-attach as a SECOND one if its caret were written bare.
    const src = '| a |\n^ cap\n\n^ x\n'
    const out = carveToCarve(src)
    expect(out).toContain('\\^ x')
    expect(carveToHtml(out)).toBe(carveToHtml(src))
  })

  it('the same paragraph with a TAB keeps the caret bare', () => {
    const src = '| a |\n^ cap\n\n^\tx\n'
    const out = carveToCarve(src)
    expect(out).toContain('\n^\tx')
    expect(carveToHtml(out)).toBe(carveToHtml(src))
  })
})
