import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CANONICAL_BLOCK_TYPES, CANONICAL_INLINE_TYPES, Profile } from '../src/index.js'

/*
 * The canonical vocabulary is what a profile can NAME, and spec docs/profiles.md
 * calls that list normative. Nothing here read the page: `ast-vocabulary.test.ts`
 * mentions it in a comment and then checks spelling, so the two lists could drift
 * from the spec without a single test noticing - and had, by six entries.
 *
 * carve-php pins its own lists against this page (NodeTypeVocabularyTest) and
 * carve-rs matches it exactly; this engine was the only one of the three with no
 * check and the only one out of step.
 *
 * WHY IT MATTERS, given the filter works anyway: `isTypeAllowed(type)` resolves a
 * type the vocabulary does not know on the caller's axis, and the string-only form
 * has no axis to resolve on, so it falls to step 3 and ALLOWS. Measured before the
 * fix, with the type explicitly denied:
 *
 *   heading_ref    isTypeAllowed(string-only) = true   with-axis = false
 *
 * Two APIs, one profile, opposite answers - for five types the page lists as
 * nameable. The filter passes an axis, which is why rendering was right and only
 * the string API lied.
 */

const here = dirname(fileURLToPath(import.meta.url))
const page = readFileSync(resolve(here, '../spec/docs/profiles.md'), 'utf8')

/** The page's own list for one axis, as data. */
function specVocabulary(axis: 'Block' | 'Inline'): string[] {
  const match = new RegExp(`\\*\\*${axis}:\\*\\*(.*?)\\n\\n`, 's').exec(page)
  if (!match) throw new Error(`no **${axis}:** list in spec/docs/profiles.md`)

  return [...match[1].matchAll(/`([a-z0-9_]+)`/g)].map((m) => m[1]).sort()
}

describe('the canonical vocabulary matches the spec page', () => {
  it('has a page to read', () => {
    // Without this a missing submodule would make both lists empty and the
    // comparisons below vacuous.
    expect(specVocabulary('Block').length).toBeGreaterThan(20)
    expect(specVocabulary('Inline').length).toBeGreaterThan(20)
  })

  it('names every block type the spec lists, and no others', () => {
    expect([...CANONICAL_BLOCK_TYPES].sort()).toEqual(specVocabulary('Block'))
  })

  it('names every inline type the spec lists, and no others', () => {
    expect([...CANONICAL_INLINE_TYPES].sort()).toEqual(specVocabulary('Inline'))
  })
})

describe('a deny reaches the string-only API for every spec-listed type', () => {
  // The consequence of the drift, stated as behavior rather than as list
  // membership: a host asking "is this type allowed" about a type it just denied
  // must not be told yes.
  for (const type of specVocabulary('Inline')) {
    it(`denyInline(['${type}']) makes isTypeAllowed('${type}') false`, () => {
      expect(Profile.full().denyInline([type]).isTypeAllowed(type)).toBe(false)
    })
  }

  for (const type of specVocabulary('Block')) {
    it(`denyBlock(['${type}']) makes isTypeAllowed('${type}') false`, () => {
      expect(Profile.full().denyBlock([type]).isTypeAllowed(type)).toBe(false)
    })
  }
})
