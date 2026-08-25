/*
 * The writer matches the canonical form the spec pins (PART 11 §2).
 *
 * The corpus formatter sweep asserts the two PART 11 §1 properties -
 * `toHtml(fmt(x)) == toHtml(x)` and `fmt(fmt(x)) == fmt(x)` - and neither can
 * see WHICH of two valid canonical forms the writer picked. Both hold for every
 * writer divergence found so far: a comment renders nothing, so a body written
 * at the wrong column still preserves the HTML, and a writer is happily
 * idempotent about a spelling it chose itself.
 *
 * The bytes are what separate one canonical form from two, and §2 is normative
 * about which one it is. The spec ships `<slug>.fmt` fixtures for exactly that.
 *
 * THE SPEC REPO ALREADY READS THEM, AND THAT IS NOT THIS CHECK. Its test
 * imports the PUBLISHED `@markup-carve/carve`, so it pins whatever build was
 * last released - the engine-pin lag that markup-carve/carve#735 is about. This
 * reads the same fixtures against the source in this repo, so a writer
 * regression fails here on the commit that introduces it rather than after a
 * release and a downstream pin bump.
 *
 * Measured before adding: this engine matches all ten fixtures at the current
 * pin, so it lands green and bites only on a regression.
 */

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { carveToCarve } from '../src/index.js'
import { CANONICAL_AHEAD_OF_PIN } from './canonical-ahead-of-pin.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const corpusDir = resolve(__dirname, '../spec/tests/corpus')

const pinned = readdirSync(corpusDir)
  .filter((name) => name.endsWith('.fmt'))
  .map((name) => name.slice(0, -'.fmt'.length))
  .filter((slug) => existsSync(resolve(corpusDir, `${slug}.crv`)))
  .sort()

/*
 * AN ENTRY THAT NAMES NOTHING IS NOT A DECLARATION. The two assertions below
 * only run for a slug that HAS a sidecar, so an entry left behind after an
 * upstream rename matched no case and read as coverage.
 */
describe('canonical AHEAD_OF_PIN', () => {
  it('names only sidecars that exist', () => {
    const orphaned = [...CANONICAL_AHEAD_OF_PIN.keys()].filter((slug) => !pinned.includes(slug))
    expect(
      orphaned,
      'renamed upstream, or already retired - either way the entry asserts nothing',
    ).toEqual([])
  })
})

describe('the pinned canonical form', () => {
  it('is read from at least one fixture, so the sweep can fail', () => {
    // Guards against a glob that quietly matches nothing - the state these
    // fixtures were already in for five releases (markup-carve/carve#671),
    // where a checker reported success having compared nothing.
    expect(pinned.length).toBeGreaterThanOrEqual(5)
  })

  for (const slug of pinned) {
    it(`is what fmt produces for ${slug}`, () => {
      const source = readFileSync(resolve(corpusDir, `${slug}.crv`), 'utf8')
      const expected = readFileSync(resolve(corpusDir, `${slug}.fmt`), 'utf8')
      const ahead = CANONICAL_AHEAD_OF_PIN.get(slug)
      if (ahead === undefined) {
        expect(carveToCarve(source)).toBe(expected)
        return
      }
      expect(carveToCarve(source), ahead.reason).toBe(ahead.fmt)
      // The staleness half: when the pin moves past the clause the sidecar is
      // rewritten to exactly this value, and the entry must be deleted.
      expect(expected, `${slug} now matches: delete its AHEAD_OF_PIN entry`).not.toBe(ahead.fmt)
    })
  }
})
