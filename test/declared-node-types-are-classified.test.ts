import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CANONICAL_BLOCK_TYPES, CANONICAL_INLINE_TYPES, FOLDED_NODE_TYPES, canonicalType } from '../src/index.js'

/*
 * `canonical-vocabulary-matches-the-spec.test.ts` pins both lists to the spec
 * page. Nothing pinned them to the node types this engine actually declares, so
 * three could sit in `ast.ts` and in no list at all: `smart_punctuation`,
 * `literal_inline` and `tag` (markup-carve/carve-js#2499). They fold, which is
 * why no profile decision was wrong - but the fold lived only in a `switch` arm,
 * so a consumer enumerating the vocabulary as an inventory got a short list and
 * `bbcode-migrate.ts` spliced one of the three back in by hand.
 *
 * The invariant here is the one that holds for the NEXT type somebody adds: a
 * declared type is either a canonical name or folds into one, and the fold is
 * written down. A type that is neither fails this file until it is classified.
 */

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(resolve(here, '../src/ast.ts'), 'utf8')

/** Every `type:` literal `ast.ts` declares, including multi-line unions. */
function declaredTypes(): string[] {
  const field = /type:\s*((?:'[a-z0-9_]+'\s*(?:\|\s*)?|\n\s*\|\s*)+)/g
  const found = new Set<string>()
  for (const match of source.matchAll(field)) {
    for (const literal of match[1].matchAll(/'([a-z0-9_]+)'/g)) found.add(literal[1])
  }
  // The root is not a block or inline node and the resolver always allows it.
  found.delete('document')

  return [...found].sort()
}

const VOCABULARY: ReadonlySet<string> = new Set([...CANONICAL_BLOCK_TYPES, ...CANONICAL_INLINE_TYPES])

describe('every node type ast.ts declares is classified', () => {
  it('found the declarations to compare against', () => {
    // Without this, a rename in ast.ts that breaks the scan would make every
    // assertion below vacuously true.
    expect(declaredTypes().length).toBeGreaterThan(50)
  })

  for (const type of declaredTypes()) {
    it(`'${type}' is a canonical name or folds into one`, () => {
      if (VOCABULARY.has(type)) return
      const folded = Object.prototype.hasOwnProperty.call(FOLDED_NODE_TYPES, type) ? FOLDED_NODE_TYPES[type] : undefined
      expect(
        folded,
        `'${type}' is declared in ast.ts, is in neither canonical vocabulary, and FOLDED_NODE_TYPES does not say what it folds into`,
      ).toBeDefined()
      expect(VOCABULARY.has(folded!), `'${type}' folds into '${folded}', which is not a canonical name either`).toBe(true)
    })
  }

  for (const [type, target] of Object.entries(FOLDED_NODE_TYPES)) {
    it(`the recorded fold for '${type}' is the one canonicalType() performs`, () => {
      // Otherwise the table could describe a fold the mapper stopped doing, which
      // is how the vocabulary and the mapper drifted in carve-js#472 and #712.
      expect(canonicalType(type)).toBe(target)
    })

    it(`'${type}' is still declared in ast.ts and is not itself nameable`, () => {
      expect(declaredTypes()).toContain(type)
      expect(VOCABULARY.has(type)).toBe(false)
    })
  }
})
