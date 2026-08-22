/*
 * PART 11 §2b: the scope of an escalation is the smallest unit that fails.
 *
 * §4's two-render strategy asks whether the minimal form of the WHOLE document
 * re-parses to the same tree, and until this clause landed the answer decided
 * the whole document: one character that genuinely needed its escape put every
 * other candidate in the conservative class with it. §2b bounds the fallback to
 * the smallest unit whose minimal form fails - the inline run, or the block
 * containing it - and every other unit is emitted by §2's own test, which for a
 * character nothing needs means bare.
 *
 * WHY THE ASSERTIONS ARE ON BYTES. §1 forgives escaping on purpose: both
 * spellings render the same HTML and re-parse to the same tree, so a round-trip
 * check cannot see the difference and neither can the corpus HTML. That is
 * exactly why three engines carried the wider scope with every gate green
 * (markup-carve/carve#1516). The bytes are the only witness, so each case pins
 * them - and then re-parses the written form to show the narrowing did not buy
 * the minimality by changing the document.
 */

import { describe, it, expect } from 'vitest'
import { carveToCarve, carveToHtml, parse } from '../src/index.js'

/** The written form, plus the proof it still says what the source said. */
function written(source: string): string {
  const out = carveToCarve(source)
  expect(carveToHtml(out), `fmt changed the document: ${JSON.stringify(out)}`).toBe(carveToHtml(source))
  expect(JSON.stringify(parse(carveToCarve(out)))).toBe(JSON.stringify(parse(out)))
  return out
}

describe('an escalation reaches the block that failed, not the document', () => {
  // The two halves apart, so the joined case below cannot be read as either
  // one of them changing on its own.
  it('escalates a block whose minimal form opens a heading it does not have', () => {
    // Indented, so the text IS `## H` rather than a heading. At column zero the
    // minimal form would open one, so this block escalates - in full, by §2's
    // THE UNIT IS THE OPENER: the run is `##`, not its first character.
    expect(written('  ## H\n')).toBe('\\#\\# H\n')
  })

  it('leaves a block whose minimal form re-parses as itself alone', () => {
    expect(written('plain (b) text\n')).toBe('plain (b) text\n')
  })

  it('does not spread the escalation from the block that needed it', () => {
    // Corpus 396 in markup-carve/carve#1516. Before §2b the second paragraph
    // came back `plain \(b\) text`, escaped because a DIFFERENT block failed.
    expect(written('  ## H\n\nplain (b) text\n')).toBe('\\#\\# H\n\nplain (b) text\n')
  })

  it('reaches the inline run before the block containing it', () => {
    // `/a/` is written braced, which puts `_b_` after a `}` instead of after a
    // `/` - so the run that was TEXT on the way in would re-parse as emphasis,
    // and it escalates. The run after the code span is in the SAME paragraph
    // and needs nothing, so a fallback that stopped at the block would escape
    // its parentheses too.
    expect(written('/a/_b_ `x` plain (d)\n')).toBe('{/a/}\\_b\\_ `x` plain (d)\n')
  })

  it('widens to the block when escaping the run is not enough', () => {
    // The failing occurrence is a `|` opening a table row, and it is a property
    // of the LINE the run begins rather than of the run: both lines of this one
    // paragraph carry one, so both are written conservatively while the
    // paragraph beside them keeps its bare candidates.
    expect(written(' | a |\n | b |\n\nsee (c) 50% now\n')).toBe(
      '\\| a \\|\n\\| b \\|\n\nsee (c) 50% now\n',
    )
  })

  it('escalates every block in a document where every block fails', () => {
    // The conservative form is still reachable - it is just arrived at because
    // each block needed it, rather than because one did.
    expect(written('  ## H\n\n  ### I\n')).toBe('\\#\\# H\n\n\\#\\#\\# I\n')
  })
})
