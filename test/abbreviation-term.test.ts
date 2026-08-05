import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * `abbreviation_term = (letter | digit)+`, with `letter` enumerated in the
 * grammar as ASCII a-z plus A-Z and `digit` as 0-9. No case rule, no length
 * rule, no Unicode.
 *
 * This engine required the term to be ALL UPPERCASE - `RE_ABBR_DEF` opened with
 * `[A-Z][A-Z0-9]*` - so `*[d]: dozen` was a literal paragraph here and a
 * definition in carve-rs and carve-php (carve#791). An abbreviation definition
 * renders NOTHING and silently changes the text around it, so the disagreement
 * costs either the definition line or the expansion when a document moves
 * between engines.
 *
 * Found by differential fuzzing (scripts/fuzz-impls.mjs seed 101 in the spec
 * repo); the corpus has no lowercase, digit-leading or non-ASCII term, so no
 * gate exercised the production's boundary.
 */
const expansionOf = (label: string) =>
  carveToHtml(`*[${label}]: expansion\n\nuse ${label} here.\n`)

describe('an abbreviation term is (letter | digit)+', () => {
  for (const label of ['HTML', 'D', 'd', 'ab', 'aB', 'Ab', '1a', '9', 'x9y']) {
    it(`accepts ${JSON.stringify(label)}`, () => {
      expect(expansionOf(label)).toContain(`<abbr title="expansion">${label}</abbr>`)
    })
  }

  // The other half of the production: anything outside `(letter | digit)+` is
  // not a term, and the line stays paragraph text. Non-ASCII is the case
  // carve-rs gets wrong in the opposite direction, and `letter` is enumerated
  // ASCII, so it belongs here.
  for (const label of ['e.g.', 'HTTP API', 'x-y', 'ß', 'Å', '']) {
    it(`declines ${JSON.stringify(label)}`, () => {
      expect(expansionOf(label)).not.toContain('<abbr')
    })
  }
})
