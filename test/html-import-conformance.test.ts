import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { htmlToAst, htmlToCarve, toAstJson } from '../src/index.js'

const root = resolve(import.meta.dirname, '../spec/tests/html-import')

/**
 * Fixtures this engine has DELIBERATELY moved PAST the pinned spec on.
 *
 * The mirror of `corpus.test.ts`'s `AHEAD_OF_PIN`, for the same reason and with
 * the same two-directional guard: an engine ahead of a pinned fixture is a
 * normal state between two pin bumps, and what is not normal is not knowing
 * which window you are in. The spec repo declares the other side of this same
 * window itself - `tests/html-import-contract.check.mjs` carries a `PIN_LAG`
 * entry for this fixture, written in the commit that ruled the clause.
 *
 * Each entry FAILS IN BOTH DIRECTIONS:
 *
 *  - the written source must equal what the CURRENT spec states, so a
 *    regression here is caught exactly as the fixture would have caught it;
 *  - and it must still DIFFER from the pinned golden, so the entry fails and
 *    has to be deleted in the same commit that moves the pin.
 */
const AHEAD_OF_PIN = new Map<string, { reason: string; carve: string }>([
  // EMPTY, and the staleness half above is why. `derived-endnotes-section` sat
  // here while PART 9 §17 L7's consumed `loose` boolean was ruled and
  // implemented (markup-carve/carve#1623, markup-carve/carve-js#1401) but not
  // yet pinned; carve commit d2bd801b rewrote the fixture to exactly what this
  // engine already wrote, so the entry goes out with the bump that reached it.
])

/**
 * The two fields that record WHERE a node was written rather than what it is.
 * Every fixture here is absent both by construction - they are a property of
 * the input, not of the import - so the published tree is compared without
 * them, exactly as the spec's own reading over these same fixtures does
 * (`spec/tests/html-import-contract.check.mjs`).
 */
const LOCATION_FIELDS = new Set(['pos', 'srcByteLength'])
const withoutLocations = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(withoutLocations)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !LOCATION_FIELDS.has(key))
      .map(([key, inner]) => [key, withoutLocations(inner)]),
  )
}

describe('shared HTML import contract', () => {
  for (const fixture of readdirSync(root)) {
    it(fixture, () => {
      const dir = resolve(root, fixture)
      const html = readFileSync(resolve(dir, 'input.html'), 'utf8')
      const expectedCarve = readFileSync(resolve(dir, 'expected.crv'), 'utf8')
      const expectedAst = JSON.parse(readFileSync(resolve(dir, 'expected.ast.json'), 'utf8'))
      const expectedReport = JSON.parse(readFileSync(resolve(dir, 'expected.report.json'), 'utf8'))
      const ast = htmlToAst(html)
      const carve = htmlToCarve(html)

      const ahead = AHEAD_OF_PIN.get(fixture)
      if (ahead) {
        expect(carve.value, ahead.reason).toBe(ahead.carve)
        // The staleness half: when the pin moves past the clause the fixture is
        // rewritten to exactly this value, and the entry must be deleted.
        expect(
          expectedCarve,
          `${fixture} now matches: delete its AHEAD_OF_PIN entry`,
        ).not.toBe(ahead.carve)
      } else {
        expect(carve.value).toBe(expectedCarve)
      }
      // THE ENGINE SIDE IS PUBLISHED FIRST (markup-carve/carve#1616). A fixture
      // records the PART 12 shape - what the contract page is a statement about
      // and what an implementation in another language is measured against. The
      // INTERNAL tree is a different object: it spells a definition-list entry
      // as `{terms, definitions}` rather than as the `definition_term` and
      // `definition_description` nodes §8 publishes, and it hangs footnote
      // definitions off the root that §7 fixes at three fields. Comparing a
      // fixture against it pins one implementation's internals as the portable
      // minimum, which is the defect the spec's own checker fixed in the commit
      // that re-recorded `traversal-shaped-index` in the published shape.
      expect(withoutLocations(toAstJson(ast.value))).toEqual(expectedAst)
      // THE REPORT IS THE SOURCE EXIT'S. A fixture's `expected.report.json`
      // records what the WRITER gave up, and the spec's own reading over these
      // fixtures compares it against `htmlToCarve`. The tree exit gives up
      // something else and often nothing: an empty `<dd>` that no source line
      // can carry survives in the AST as a `definition_description` with no
      // children, so `htmlToAst` reports a loss it did not take. Reading the
      // tree's report against a source fixture compares two different questions
      // and fails on the answer to the one not asked.
      expect(carve.report).toMatchObject(expectedReport)
    })
  }
})

describe('AHEAD_OF_PIN', () => {
  it('names only fixtures that exist', () => {
    const present = new Set(readdirSync(root))
    const orphaned = [...AHEAD_OF_PIN.keys()].filter((name) => !present.has(name))
    expect(orphaned, 'renamed upstream, or already retired - either way the entry asserts nothing').toEqual([])
  })
})
