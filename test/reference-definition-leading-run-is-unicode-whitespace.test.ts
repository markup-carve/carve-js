import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

/**
 * The whitespace run between a reference definition's mandatory separator space
 * and its destination is Unicode White_Space (markup-carve/carve#892).
 *
 * `resources/grammar.ebnf:1325-1339`: "Whitespace between the mandatory
 * separator space and the destination is leading whitespace and is skipped",
 * with the class at `:1313-1323`: "WHITESPACE HERE IS UNICODE WHITESPACE --
 * NORMATIVE [...] The test is the Unicode White_Space property, not 'is
 * invisible'."
 *
 * `RE_LINK_DEF` carved U+00A0 out of that run by hand, and since the destination
 * right after it is `\P{White_Space}+`, a no-break space there could neither be
 * skipped nor started on. The whole pattern failed, so the line was not a
 * definition at all and every reference to the label went unresolved. carve-rs
 * `2ec3c1c` and carve-php `876e312` both define it; carve-js already agreed with
 * them on U+2009, U+202F and U+3000, so the divergence was one character wide.
 */
describe('a reference definition', () => {
  const defines = (run: string) =>
    carveToHtml(`[link][r]\n\n[r]:${run}https://e.com/\n`).includes('href="https://e.com/"')

  it('skips a no-break space in the run after the separator space', () => {
    // The ticket's row, and the only one where this engine diverged.
    expect(defines('  ')).toBe(true)
  })

  it('skips a RUN of them, and a run mixed with ASCII spaces in either order', () => {
    // The clause is about the whole run, so a check on its FIRST character alone
    // passes ` <NBSP>x` and fails `<NBSP> x`. Both are one definition here.
    expect(defines('    ')).toBe(true)
    expect(defines('     ')).toBe(true)
    expect(defines('     ')).toBe(true)
    expect(defines('     ')).toBe(true)
  })

  it('skips the other Unicode spaces it already skipped', () => {
    // The rows that were right before this change and must stay right: a fix
    // that swapped the class for something narrower would take these out.
    for (const ch of [' ', ' ', '　', ' ', ' ', '']) {
      expect({ ch, defines: defines(` ${ch}`) }).toEqual({ ch, defines: true })
    }
  })

  it('keeps a zero-width character in the destination instead of skipping it', () => {
    // The discriminator the clause states outright, pinned at
    // `docs/examples/edge-cases.md:9500-9518`: U+FEFF and U+200B are NOT
    // White_Space, so they are ordinary destination characters. Widening the run
    // to "is invisible" would swallow these and change the href.
    expect(carveToHtml('[link][r]\n\n[r]: ﻿https://e.com/\n')).toContain(
      'href="﻿https://e.com/"',
    )
    expect(carveToHtml('[link][r]\n\n[r]: ​https://e.com/\n')).toContain(
      'href="​https://e.com/"',
    )
  })

  it('is still not a definition when the run is all there is', () => {
    // The destination must be NON-EMPTY once the run is skipped
    // (grammar.ebnf:1322-1324). Skipping the run must not turn `[r]: <NBSP>`
    // into a definition with an empty href.
    //
    // This is the CONTROL: it is the one case here that no mutation of the run's
    // class breaks, because `\P{White_Space}+` refuses an empty destination
    // whatever the run admits. It bounds the assertions above rather than
    // proving any of them.
    expect(carveToHtml('[link][r]\n\n[r]:  \n')).not.toContain('href')
    expect(carveToHtml('[link][r]\n\n[r]:  \n')).not.toContain('href')
  })

  it('still requires the mandatory separator space before the run', () => {
    // The separator itself is the `space` terminal and nothing else
    // (grammar.ebnf:1434-1440). A no-break space in ITS place is not a
    // definition, however permissive the run after it is.
    expect(carveToHtml('[link][r]\n\n[r]: https://e.com/\n')).not.toContain('href')
    expect(carveToHtml('[link][r]\n\n[r]:\thttps://e.com/\n')).not.toContain('href')
  })

  it('still treats a leading no-break space as content, not indentation', () => {
    // The INDENT class at the front of the pattern is a different slot and keeps
    // the repo-wide idiom. Relaxing the whole pattern rather than the one run
    // would make this a definition.
    expect(carveToHtml('[link][r]\n\n [r]: https://e.com/\n')).not.toContain('href')
  })

  it('leaves a plain definition and an ASCII run alone', () => {
    // Not a bystander: a run written to match ONE character rather than the
    // whole run passes the single-space case here and fails the three-space one,
    // which is the same first-character-versus-run mistake the case above tests
    // from the non-ASCII side.
    expect(defines(' ')).toBe(true)
    expect(defines('   ')).toBe(true)
  })

  it('does not change what the title slot admits', () => {
    // The run is one of three whitespace slots on the line; the title
    // introducer is a separate `\p{White_Space}+` and is untouched.
    expect(carveToHtml('[link][r]\n\n[r]:  https://e.com/ "T"\n')).toContain('title="T"')
  })
})
