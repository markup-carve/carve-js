import { describe, it, expect } from 'vitest'
import { carveToCarve } from '../src/index.js'

/**
 * An abbreviation definition is NOT collected, so it is written where it sits.
 *
 * §7 moves the two COLLECTED definition kinds - `link_reference_definition` and
 * `footnote` - to the document and orders them by source position. It refuses
 * that for `abbreviation_def` specifically, "since hoisting it would empty the
 * line rather than relocate visible output", so the node already sits at its
 * source position.
 *
 * carve-js#752 put `abbreviation_def` in the writer's hoisted set, which moved
 * every abbreviation definition to the end of the document - a regression that
 * `compare:impls` reported on five corpus documents at once, all of them
 * abbreviation cases, with carve-rs and carve-php agreeing against this engine.
 */
describe('an abbreviation definition stays where it was written', () => {
  it('keeps definitions above the paragraph that uses them', () => {
    const src = "*[HTML]: HyperText Markup Language\n\n*[CSS]: Cascading Style Sheets\n\nHTML and CSS.\n"
    expect(carveToCarve(src)).toBe(
      '*[HTML]: HyperText Markup Language\n\n*[CSS]: Cascading Style Sheets\n\nHTML and CSS.\n',
    )
  })

  it('keeps a definition written after the text where it was', () => {
    const src = 'HTML is fine.\n\n*[HTML]: HyperText\n'
    expect(carveToCarve(src)).toBe(src)
  })

  it('still hoists a link definition, which IS collected', () => {
    // The control: the two kinds are treated differently on purpose, so a fix
    // that stopped hoisting everything would pass the assertions above.
    const src = "see[^a] and [t][r]\n\n[^a]: note\n\n[r]: /u\n"
    expect(carveToCarve(src)).toBe('see[^a] and [t][r]\n\n[^a]: note\n\n[r]: /u\n')
  })
})
