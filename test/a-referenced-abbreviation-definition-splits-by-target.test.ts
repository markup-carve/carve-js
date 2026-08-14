import { describe, expect, it } from 'vitest'
import { carveToAnsi, carveToCarve, carveToMarkdown, carveToPlainText } from '../src/index.js'

/**
 * PART 11 §10f. §10a rules the definition NOTHING references - it survives on
 * the Markdown, plain-text and terminal targets. §10f rules the one that IS
 * referenced, and splits the three:
 *
 *   T1 MARKDOWN KEEPS THE LINE, and keeps the expansion beside it exactly as
 *      today. `*[TERM]: expansion` is the spelling PHP Markdown Extra uses [...]
 *      so on this target the line is CONTENT rather than leaked source.
 *
 *   T2 PLAIN TEXT AND THE TERMINAL DROP THE LINE and emit only the expansion,
 *      in the `TERM (expansion)` shape, at every occurrence.
 *
 * The canonical writer keeps the line whatever became of the definition,
 * because PART 11 §1's `parse(fmt(x)) == parse(x)` requires it. That direction
 * is the OPPOSITE of plain and the terminal, so it is asserted here rather than
 * assumed to follow from Markdown.
 *
 * The spec corpus pins six of these bytes through
 * `corpus-render-fixtures.test.ts`. This file pins the rule itself, including
 * the two shapes no corpus case reaches, and it does so on all four writer
 * paths at once so a target cannot be moved without the other three being
 * looked at.
 *
 * The dim styling is built from escapes rather than pasted, so a formatter
 * cannot silently eat a control character out of an expected string.
 */
const DIM = '\x1b[2m'
const RESET = '\x1b[0m'
const UNDERLINE = '\x1b[4m'

/** `TERM (expansion)` with the parenthetical dim, the terminal's shape. */
const expanded = (term: string, expansion: string): string =>
  `${term}${DIM} (${expansion})${RESET}`

/** A definition line as the terminal writes it, dim end to end. */
const definitionLine = (term: string, expansion: string): string =>
  `${DIM}*[${term}]: ${expansion}${RESET}`

describe('PART 11 §10f: a referenced abbreviation definition splits by target', () => {
  describe('the definition is consumed', () => {
    const src = '*[HTML]: Hyper Text\n\nHTML\n'

    it('Markdown keeps the line and the expansion beside it (T1)', () => {
      expect(carveToMarkdown(src)).toBe(
        '*[HTML]: Hyper Text\n\n<abbr title="Hyper Text">HTML</abbr>\n',
      )
    })

    it('plain text drops the line and gains the expansion (T2, both halves)', () => {
      // Both halves move together. carve#1178 left this target without an
      // automatic expansion on the ground that the definition line carried the
      // mapping; §10f takes the line away, so emitting neither would lose the
      // author's text outright.
      expect(carveToPlainText(src)).toBe('HTML (Hyper Text)\n')
    })

    it('the terminal drops the line and keeps the expansion it already wrote (T2)', () => {
      expect(carveToAnsi(src)).toBe(`${expanded('HTML', 'Hyper Text')}\n`)
    })

    it('the canonical writer keeps the line, for PART 11 §1', () => {
      expect(carveToCarve(src)).toBe('*[HTML]: Hyper Text\n\nHTML\n')
    })
  })

  it('emits the expansion at EVERY occurrence, not just the first', () => {
    const src = '*[HTML]: Hyper Text\n\nHTML and HTML.\n'

    expect(carveToPlainText(src)).toBe('HTML (Hyper Text) and HTML (Hyper Text).\n')
    expect(carveToAnsi(src)).toBe(
      `${expanded('HTML', 'Hyper Text')} and ${expanded('HTML', 'Hyper Text')}.\n`,
    )
  })

  describe('the term never appears - §10a, which §10f leaves alone', () => {
    const src = '*[HTML]: Hyper Text\n\nbody\n'

    it('every target keeps the line', () => {
      expect(carveToMarkdown(src)).toBe('*[HTML]: Hyper Text\n\nbody\n')
      expect(carveToPlainText(src)).toBe('*[HTML]: Hyper Text\n\nbody\n')
      expect(carveToAnsi(src)).toBe(`${definitionLine('HTML', 'Hyper Text')}\n\nbody\n`)
      expect(carveToCarve(src)).toBe('*[HTML]: Hyper Text\n\nbody\n')
    })
  })

  describe('an authored `abbr` outranks the definition - PART 9 §9', () => {
    // The corpus shape, `45-inline-extensions-11`. The resolved abbreviation
    // under that span contributes only its visible text, so THIS definition's
    // expansion reaches no target and its line stays. The test §10f states is
    // whether the expansion is emitted, not whether the term appears - and the
    // term appears here.
    const src = '*[HTML]: Hyper Text Markup Language\n\n[HTML]{abbr="Custom"}\n'

    it('plain keeps the line and prints the AUTHORED value', () => {
      expect(carveToPlainText(src)).toBe(
        '*[HTML]: Hyper Text Markup Language\n\nHTML (Custom)\n',
      )
    })

    it('the terminal keeps the line and prints the AUTHORED value', () => {
      expect(carveToAnsi(src)).toBe(
        `${definitionLine('HTML', 'Hyper Text Markup Language')}\n\n${expanded('HTML', 'Custom')}\n`,
      )
    })
  })

  describe('a later definition of the same term won - PART 9R R3, last wins', () => {
    // Only `b` is ever emitted, so `*[A]: b` goes and `*[A]: a` stays. Dropping
    // every definition of an expanded TERM would delete the string `a` from the
    // document, which is the loss this clause moves anything to avoid - so the
    // lookup is keyed by the pair, not by the term.
    const src = '*[A]: a\n*[A]: b\n\nA here.\n'

    it('Markdown keeps both lines', () => {
      expect(carveToMarkdown(src)).toBe('*[A]: a\n\n*[A]: b\n\n<abbr title="b">A</abbr> here.\n')
    })

    it('plain keeps the loser and drops the winner', () => {
      expect(carveToPlainText(src)).toBe('*[A]: a\n\nA (b) here.\n')
    })

    it('the terminal keeps the loser and drops the winner', () => {
      expect(carveToAnsi(src)).toBe(
        `${definitionLine('A', 'a')}\n\n${expanded('A', 'b')} here.\n`,
      )
    })

    it('the canonical writer keeps both', () => {
      expect(carveToCarve(src)).toBe('*[A]: a\n\n*[A]: b\n\nA here.\n')
    })
  })

  it('answers per TARGET, because the two disagree on where an authored `abbr` counts', () => {
    // `renderPlainText` honors an authored `abbr` on emphasis, strong,
    // underline, superscript and span; `renderAnsi` honors it on span only, and
    // gives underline its own arm that never reads the attribute. So on the
    // SAME document the definition's expansion reaches one target and not the
    // other, and §10f's test has to be answered separately for each.
    //
    // That divergence is carve#1127's, not this clause's, and it is pinned here
    // only to keep the answer honest on both sides. Sharing one answer would
    // break one of them: the terminal would keep a line whose expansion it
    // emits (duplication), or plain would drop a line and print `Custom` alone,
    // losing `Hyper Text` from the document entirely.
    const src = '*[HTML]: Hyper Text\n\n_HTML_{abbr="Custom"}\n'

    // Plain suppresses, so `Hyper Text` is emitted nowhere but the line.
    expect(carveToPlainText(src)).toBe('*[HTML]: Hyper Text\n\nHTML (Custom)\n')
    // The terminal does not suppress, so it emits `Hyper Text` and drops it.
    expect(carveToAnsi(src)).toBe(
      `${UNDERLINE}${expanded('HTML', 'Hyper Text')}${RESET}\n`,
    )
  })
})
