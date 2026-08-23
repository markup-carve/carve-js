import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { htmlToAst, htmlToCarve } from '../src/index.js'

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
  [
    'derived-endnotes-section',
    {
      // PART 9 §17 L7 (markup-carve/carve#1623, markup-carve/carve-js#1401).
      // A document with a single footnote imports as exactly ONE list item, and
      // a blank line needs two items to stand between - so before the consumed
      // `loose` boolean this fixture's source parsed TIGHT while the tree
      // recorded beside it said loose. The writer now spells the key, which is
      // what markup-carve/carve commit d2bd801b rewrote the fixture to.
      reason: 'the one-item loose list now has a spelling: the consumed `loose` boolean',
      carve: '---\n\n{loose}\n1. Note text.\n',
    },
  ],
])

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
      expect(ast.value).toEqual(expectedAst)
      expect(ast.report).toMatchObject(expectedReport)
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
