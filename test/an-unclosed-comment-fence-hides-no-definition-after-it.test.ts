import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/**
 * AN UNCLOSED `%%%` DOES NOT OPEN A BLOCK (PART 9 §28). It degrades to a `%%`
 * line comment, so every following block still renders - and, because it never
 * opened an opaque region, every following DEFINITION is still collected
 * (markup-carve/carve-js#1118, ruled 2026-08-16).
 *
 * THE LEADING BLANK LINE IN THE REPORT IS NOT THE CAUSE, and a fix that
 * pattern-matched on it would have passed its own test while leaving the defect
 * in place. The blank only moves the `%%%` off line 0. A paragraph, a heading,
 * or anything else above it does the same thing:
 *
 *   p
 *
 *   %%%
 *   [d]: u
 *
 * fails identically with no leading blank anywhere. The rows below sweep the
 * opener across line positions rather than asserting the reported pair.
 *
 * THE CAUSE IS AN `after` ARGUMENT MEASURED FROM THE WRONG CURSOR.
 * `commentBlockHasCloser` asks "is there a closer of this width after line
 * `after`", and the closer index stores the LAST line carrying a run of that
 * width - which, for an unclosed fence, is the OPENER ITSELF. Every
 * block-parsing caller stands on the opener, so `lexer.pos` is the right line
 * for them. The definition prepass is not a cursor: it sweeps the document with
 * an index of its own while `lexer.pos` stays parked at the end of the
 * frontmatter, which is line 0 for a document without any. So the prepass asked
 * "is there a closer after line 0" on behalf of an opener on line 7, the opener
 * matched itself, and the region opened. The check could only ever fail - that
 * is, work - for an opener on line 0.
 *
 * WHICH IS WHY IT WAS TWO OF THE THREE DEFINITION KINDS. Link reference and
 * abbreviation definitions are registered by the prepass and vanished; footnote
 * definitions are collected during block parsing, which uses the same helper
 * from a real cursor, and were never affected. That asymmetry is the tell, and
 * it has a control row.
 *
 * THE OPPOSITE RULE MUST SURVIVE: a definition inside a CLOSED `%%%` registers
 * nothing, because a comment's body is opaque. A fix that simply stopped
 * opening the region would resolve the reported document and silently activate
 * every commented-out definition, so both directions are asserted.
 *
 * Verified against carve-rs `69e456e` and carve-php `e140311`, both built from
 * `origin/main`; all three engines agree on every row.
 */

/** Whether `see [x][d]` resolved, i.e. whether the definition was collected. */
const resolved = (src: string): boolean => /<a href="u">x<\/a>/.test(carveToHtml(src))

describe('an unclosed comment fence hides no definition after it', () => {
  it('collects the definition with a leading blank line, as without one', () => {
    // The reported pair. The two documents differ by one empty line at the very
    // start of the file, and a blank line cannot carry meaning.
    const withBlank = '\n%%%\n[d]: u\n\nsee [x][d]\n'
    const withoutBlank = '%%%\n[d]: u\n\nsee [x][d]\n'
    expect(carveToHtml(withBlank)).toBe('<p>see <a href="u">x</a></p>')
    expect(carveToHtml(withoutBlank)).toBe('<p>see <a href="u">x</a></p>')
    expect(carveToHtml(withBlank)).toBe(carveToHtml(withoutBlank))
  })

  it('collects it wherever the opener sits, blank line or not', () => {
    // THE ROW THAT A "document starts with a blank" SPECIAL CASE FAILS. Every
    // one of these puts the `%%%` off line 0 by different means, and only the
    // first uses a blank line at all.
    const preambles = ['\n', '\n\n', 'p\n\n', '# h\n\n', '> q\n\n', '- i\n\n', '%% c\n', '---\nt: 1\n---\n\n']
    const unresolved = preambles.filter((p) => !resolved(p + '%%%\n[d]: u\n\nsee [x][d]\n'))
    expect(unresolved).toEqual([])
  })

  it('expands an abbreviation defined after an unclosed fence', () => {
    // The second prepass-registered kind, and the second half of the report.
    expect(carveToHtml('\n%%%\n*[A]: d\n\nA here\n')).toBe('<p><abbr title="d">A</abbr> here</p>')
    expect(carveToHtml('%%%\n*[A]: d\n\nA here\n')).toBe('<p><abbr title="d">A</abbr> here</p>')
  })

  it('CONTROL a footnote definition was never affected, in either spelling', () => {
    // Collected during block parsing rather than by the prepass, which is why
    // the report saw two of the three kinds break. If this row ever starts
    // depending on the leading blank, the fix moved something it should not
    // have.
    for (const src of ['\n%%%\n[^n]: note\n\nref[^n]\n', '%%%\n[^n]: note\n\nref[^n]\n']) {
      expect(carveToHtml(src)).toContain('href="#fn1"')
      expect(carveToHtml(src)).toContain('note')
    }
  })

  it('still renders the blocks after an unclosed fence', () => {
    // PART 9 §28's own example, and the half that already worked - the opener
    // degrades to a line comment and the text after it is not swallowed.
    expect(carveToHtml('before\n\n%%%\nsecret\n\nafter\n')).toBe(
      '<p>before</p>\n<p>secret</p>\n<p>after</p>',
    )
  })

  it('a definition inside a CLOSED comment still registers nothing', () => {
    // The opposite rule (PART 9 §28 again): a comment's body is opaque, so a
    // definition written in one is invisible AND inactive. A fix that stopped
    // opening the region unconditionally would activate every commented-out
    // definition and pass every row above.
    expect(carveToHtml('%%%\n[d]: u\n%%%\n\nsee [x][d]\n')).toBe('<p>see [x][d]</p>')
    expect(resolved('%%%\n[d]: u\n%%%\n\nsee [x][d]\n')).toBe(false)
    // Off line 0 as well, which is the position this fix changes.
    expect(resolved('p\n\n%%%\n[d]: u\n%%%\n\nsee [x][d]\n')).toBe(false)
    expect(resolved('\n%%%\n[d]: u\n%%%\n\nsee [x][d]\n')).toBe(false)
    // Same for an abbreviation.
    expect(carveToHtml('\n%%%\n*[A]: d\n%%%\n\nA here\n')).toBe('<p>A here</p>')
  })

  it('a definition AFTER a closed comment is collected', () => {
    // The region has to end where its closer says, not run to EOF.
    expect(resolved('%%%\nhidden\n%%%\n\n[d]: u\n\nsee [x][d]\n')).toBe(true)
    expect(resolved('\n%%%\nhidden\n%%% end\n\n[d]: u\n\nsee [x][d]\n')).toBe(true)
  })

  it('matches the closer on EXACT width, from any opener position', () => {
    // A wider fence nests, so a `%%%` inside `%%%%` does not close it - and the
    // width bookkeeping must survive the cursor change.
    expect(resolved('%%%%\n%%%\n[d]: u\n%%%%\n\nsee [x][d]\n')).toBe(false)
    expect(resolved('p\n\n%%%%\n%%%\n[d]: u\n%%%%\n\nsee [x][d]\n')).toBe(false)
    // An unclosed WIDER fence degrades the same way a `%%%` does.
    expect(resolved('\n%%%%\n[d]: u\n\nsee [x][d]\n')).toBe(true)
  })

  it('an unclosed opener after a CLOSED pair degrades on its own', () => {
    // The closer index stores the LAST line of each width, so the second,
    // unclosed opener must not borrow the first pair's closer - it sits after
    // it. This is the row that a fix comparing against the wrong line gets
    // wrong in the other direction.
    expect(resolved('%%%\nx\n%%%\n\n%%%\n[d]: u\n\nsee [x][d]\n')).toBe(true)
    // And the first pair still hides its own body.
    expect(carveToHtml('%%%\nhidden\n%%%\n\n%%%\n[d]: u\n\nsee [x][d]\n')).not.toContain('hidden')
  })

  it('TWO `%%%` lines are a PAIR, so only the definition below them is collected', () => {
    // Worth stating because it reads like "two unclosed openers" and is not: a
    // closer needs no distinguishing spelling, so the second `%%%` closes the
    // first. The definition BETWEEN them is inside a comment and registers
    // nothing; the one after them is collected. All three engines agree, and
    // getting this backwards is how a fix that simply refuses to open the
    // region would present.
    const out = carveToHtml('\n%%%\n[d]: u\n\n%%%\n[e]: v\n\nsee [x][d] and [y][e]\n')
    expect(out).toBe('<p>see [x][d] and <a href="v">y</a></p>')
  })

  it('a comment inside a QUOTE is judged from the opener too', () => {
    // Raised by codex review at high effort as a regression, and it is the
    // opposite: these are the rows where carve-js used to answer alone.
    //
    // The closer index is built over RAW lines, so a `> %%%` closer is not in
    // it, while the prepass matches its opener AFTER stripping the container
    // prefix. Measuring from line 0 let a quoted opener borrow an unrelated
    // TOP-LEVEL closer that happened to share its width and sit earlier in the
    // document - an opener cannot be closed by a line above it, and that is
    // what the old cursor allowed. Measuring from the opener ends it.
    //
    // Each of these changed with this fix, and each moved carve-js FROM
    // disagreeing with carve-rs and carve-php TO agreeing with them.
    const quotedAfterPair = '%%%\nx\n%%%\n\n> %%%\n> [d]: u\n> %%%\n\nsee [x][d]\n'
    expect(resolved(quotedAfterPair)).toBe(true)
    expect(resolved('%%%\nx\n%%%\n\n> %%%\n> [d]: u\n\nsee [x][d]\n')).toBe(true)
    expect(resolved('> %%%\n> x\n> %%%\n\n%%%\n[d]: u\n\nsee [x][d]\n')).toBe(true)
    expect(resolved('%%%\na\n%%%\n\n> %%%\n> b\n> %%%\n\n%%%\n[d]: u\n\nsee [x][d]\n')).toBe(true)
    // CONTROL: the quoted shapes that did NOT depend on a stray earlier closer
    // are unchanged, so the fix did not simply stop opening quoted regions.
    expect(resolved('> %%%\n> [d]: u\n> %%%\n\nsee [x][d]\n')).toBe(true)
    expect(resolved('> %%%\n> [d]: u\n\nsee [x][d]\n')).toBe(true)
    // CONTROL: width still nests inside a quote.
    expect(resolved('> %%%%\n> %%%\n> [d]: u\n> %%%%\n\nsee [x][d]\n')).toBe(true)
  })

  it('three `%%%` lines leave the third one degrading on its own', () => {
    // The pair above plus a genuinely unclosed opener. Only the definition
    // under the THIRD fence survives, and it survives from any start position -
    // which is the case the old cursor got wrong.
    const doc = '%%%\n[c]: t\n%%%\n\n%%%\n[d]: u\n\nsee [x][d]\n'
    expect(resolved(doc)).toBe(true)
    expect(resolved('p\n\n' + doc)).toBe(true)
    expect(carveToHtml(doc)).toBe('<p>see <a href="u">x</a></p>')
  })
})
