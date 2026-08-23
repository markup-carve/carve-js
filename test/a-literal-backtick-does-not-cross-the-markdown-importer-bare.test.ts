import { describe, it, expect } from 'vitest'
import {
  escapeAttributeBlockOpener,
  escapePlainCarveInlineSyntax,
  escapeVerbatimDelimiter,
  HANDLED_DJOT,
  HANDLED_MARKDOWN,
} from '../src/carve-escape.js'
import { carveToHtml, markdownToCarve } from '../src/index.js'

/**
 * Two characters `markdownToCarve` carried across bare that CommonMark and GFM
 * read as ordinary text and Carve reads as markup, so the migrated document
 * grew markup the source never had.
 *
 * An UNMATCHED backtick is the unbounded one: an opener with no equal-length
 * closer ahead does not fall back to text in Carve, it opens a verbatim span
 * running to the end of the block, so one stray backtick in extracted prose
 * swallowed the rest of the line. `{#id}` is the same shape without the reach.
 *
 * The bounds are the difficulty, and they are asserted here rather than assumed:
 * a MATCHED backtick is a code span the converter carries over and must stay
 * bare, and `{#id}` is a deliberate attribute block wherever the source language
 * means one - so the escape lives at the Markdown CALL SITE and neither the
 * shared escaper nor the Djot profile moves.
 */
describe('a literal backtick and a literal attribute brace do not cross the Markdown importer bare', () => {
  const BT = String.fromCharCode(96)
  const html = (src: string) => carveToHtml(src).replace(/\s+/g, ' ').trim()

  it('escapes a single unmatched backtick, which opened a span to the end of the block', () => {
    expect(markdownToCarve('a ' + BT + 'b').trim()).toBe('a \\' + BT + 'b')
    expect(html(markdownToCarve('a ' + BT + 'b'))).toBe('<p>a ' + BT + 'b</p>')
  })

  it('escapes EVERY run of an unmatched pair, not just the first', () => {
    const md = 'one ' + BT + ' and two ' + BT + BT + ' in prose'
    expect(markdownToCarve(md).trim()).toBe(
      'one \\' + BT + ' and two \\' + BT + '\\' + BT + ' in prose',
    )
    expect(html(markdownToCarve(md))).toBe('<p>one ' + BT + ' and two ' + BT + BT + ' in prose</p>')
  })

  it('escapes an unmatched run of three, which is inline text mid-line', () => {
    const md = 'a ' + BT + BT + BT + ' b'
    expect(html(markdownToCarve(md))).toBe('<p>a ' + BT + BT + BT + ' b</p>')
  })

  it('escapes an attribute-block brace standing in prose, where it attaches to nothing', () => {
    expect(markdownToCarve('a {#id} b').trim()).toBe('a \\{\\#id} b')
    expect(html(markdownToCarve('a {#id} b'))).toBe('<p>a {#id} b</p>')
  })

  it('escapes the brace AND the tag sigil behind it, since half an escape leaves a live tag', () => {
    // The `#` rule declines a `#` an UNESCAPED `{` precedes, deferring to the
    // braced-pair rule. Escaping the brace takes that premise away, so escaping
    // only the brace yielded `\{` in front of a live tag span.
    const carve = markdownToCarve('a {#id} b').trim()
    expect(carve).toContain('\\#id')
    expect(html(carve)).not.toContain('class="tag"')
  })

  // ---- BOUND: a matched backtick is a code span and must stay bare ----

  it('leaves a MATCHED backtick alone, because it is a code span the converter carries over', () => {
    expect(markdownToCarve('a ' + BT + 'code' + BT + ' b').trim()).toBe(
      'a ' + BT + 'code' + BT + ' b',
    )
    expect(html(markdownToCarve('a ' + BT + 'code' + BT + ' b'))).toBe(
      '<p>a <code>code</code> b</p>',
    )
  })

  it('leaves a matched DOUBLE run and a span holding a backtick alone', () => {
    const md = 'a ' + BT + BT + ' x ' + BT + ' y ' + BT + BT + ' b'
    expect(markdownToCarve(md).trim()).toBe(md)
    expect(html(markdownToCarve(md))).toBe('<p>a <code>x ' + BT + ' y</code> b</p>')
  })

  it('leaves a fenced code block and its body alone, marker line included', () => {
    // The list collector takes a fence the MARKER LINE opens into an inline run,
    // so the fence reached the inline escapers. Its backticks are the fence, not
    // literal prose.
    const F = BT + BT + BT
    expect(markdownToCarve(F + '\nx\n' + F + '\n')).toContain(F + '\nx\n' + F)
    expect(markdownToCarve('- ' + F + '\n  ===\n  ' + F + '\n')).toContain('- ' + F)
    expect(markdownToCarve('> ' + F + '\n> ===\n> ' + F + '\n')).toContain('> ' + F)
  })

  it('does not escape a backtick the source already escaped', () => {
    expect(markdownToCarve('a \\' + BT + 'b').trim()).toBe('a \\' + BT + 'b')
  })

  // ---- BOUND: an attribute block a source language MEANS stays bare ----

  it('leaves the brace to the attributes dialect, where the id is deliberate', () => {
    expect(markdownToCarve('a {#id} b', { attributes: true }).trim()).toBe('a {#id} b')
    expect(markdownToCarve('a [t]{#id} b', { attributes: true }).trim()).toBe('a [t]{#id} b')
  })

  it('leaves a Djot attribute block alone, since the escape is not in the shared escaper', () => {
    // `{#id}` in Djot source is a pinned id, so the DJOT profile must not gain
    // this escape - which is exactly why it lives at the Markdown call site.
    expect(escapePlainCarveInlineSyntax('a {#id} b', HANDLED_DJOT)).toBe('a {#id} b')
    expect(escapePlainCarveInlineSyntax('a ' + BT + 'b', HANDLED_DJOT)).toBe('a ' + BT + 'b')
  })

  it('leaves the shared delimiter escaper unmoved for the Markdown profile too', () => {
    // The two characters were never in any handled set: the escaper has no rule
    // for either, under any profile, and the fix adds none. A test that measured
    // the escaper alone would therefore have shown no change at all.
    expect(escapePlainCarveInlineSyntax('a {#id} b', HANDLED_MARKDOWN)).toBe('a {#id} b')
    expect(escapePlainCarveInlineSyntax('a ' + BT + 'b', HANDLED_MARKDOWN)).toBe('a ' + BT + 'b')
  })

  it('keeps the two helpers composed in the order that escapes the tag sigil', () => {
    // The opener FIRST, then the delimiter escaper - the order bbcode-migrate.ts
    // uses. Reversed, the `#` is left live.
    expect(
      escapePlainCarveInlineSyntax(escapeAttributeBlockOpener('a {#id} b'), HANDLED_MARKDOWN),
    ).toBe('a \\{\\#id} b')
    expect(
      escapeAttributeBlockOpener(escapePlainCarveInlineSyntax('a {#id} b', HANDLED_MARKDOWN)),
    ).toBe('a \\{#id} b')
  })

  it('leaves a tilde pair alone, which GFM reads as strikethrough too', () => {
    // Named so it is not "fixed" alongside these: the converter's dialect is
    // CommonMark AND GFM, and GFM strikes a single-tilde pair.
    expect(markdownToCarve('a ~tilde~ b').trim()).toBe('a ~tilde~ b')
  })

  it('escapes both characters through the shared helpers directly', () => {
    expect(escapeVerbatimDelimiter('a ' + BT + 'b')).toBe('a \\' + BT + 'b')
    expect(escapeAttributeBlockOpener('a {#id} b')).toBe('a \\{#id} b')
  })
})
