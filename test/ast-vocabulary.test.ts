import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/*
 * The AST `type` strings are the Carve spec's normative node-type vocabulary
 * (spec docs/profiles.md). They were not always: carve-js used `italic`,
 * `code-block`, `crossref` and others, which meant a document's node types
 * depended on which implementation parsed it, and anything keyed by node type -
 * profiles, chat-flavor tables - could not be shared across implementations.
 *
 * This guards the convergence. Without it the vocabulary drifts again the first
 * time someone adds a node type and reaches for a hyphen.
 */

const here = dirname(fileURLToPath(import.meta.url))
const astSource = readFileSync(resolve(here, '../src/ast.ts'), 'utf8')

/** Every `type: '...'` discriminant declared in the AST, including unions. */
function declaredTypes(): string[] {
  const types = new Set<string>()
  for (const match of astSource.matchAll(/type:\s*((?:\s*\|?\s*'[a-z0-9_-]+')+)/g)) {
    for (const inner of match[1].matchAll(/'([a-z0-9_-]+)'/g)) {
      types.add(inner[1])
    }
  }
  return [...types].sort()
}

/*
 * Types still awaiting a spec decision, so still hyphenated. Each needs a
 * resolution rather than an indefinite exemption:
 *
 * - critic-comment: whether CriticMarkup's comment folds into `comment` or
 *   becomes `critic_comment`. Folding would lose which syntax the author
 *   wrote, the same objection that keeps `autolink` separate from `link`.
 */
const PENDING_SPEC_DECISION = new Set(['critic-comment'])

describe('AST node-type vocabulary', () => {
  it('finds the declared types', () => {
    expect(declaredTypes().length).toBeGreaterThan(30)
  })

  it('uses snake_case, matching the spec vocabulary', () => {
    const offenders = declaredTypes().filter(
      (type) => !PENDING_SPEC_DECISION.has(type) && !/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/.test(type),
    )
    expect(offenders).toEqual([])
  })

  it('does not reintroduce a renamed type', () => {
    const renamed = [
      'italic',
      'super',
      'sub',
      'blockquote',
      'code-block',
      'crossref',
      'extension',
      'bold-italic',
      'citation-group',
      'critic-insert',
      'critic-delete',
      'critic-substitute',
    ]
    const declared = new Set(declaredTypes())
    expect(renamed.filter((type) => declared.has(type))).toEqual([])
  })

  it('keeps the types the spec adopted from carve-js', () => {
    // The spec took carve-js's shape for these rather than folding them into a
    // neighbour, so they must survive the convergence.
    const declared = new Set(declaredTypes())
    expect(declared.has('autolink')).toBe(true)
    expect(declared.has('admonition')).toBe(true)
  })
})
