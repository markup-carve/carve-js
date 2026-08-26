import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'
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
 * Types still awaiting a spec decision, so still hyphenated.
 *
 * Empty, and worth keeping that way. The last entry was `critic-comment`: the
 * open question was whether CriticMarkup's comment folds into `comment` or
 * becomes `critic_comment`, and it resolved to the latter - folding would lose
 * which syntax the author wrote, the same objection that keeps `autolink`
 * separate from `link` (carve#401).
 */
const PENDING_SPEC_DECISION = new Set<string>([])

const pendingDecisionDrift = (types: Iterable<string>, pending: Iterable<string>): string[] => {
  const declared = new Set(types)
  return [...pending].filter(
    (type) => !declared.has(type) || /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/.test(type),
  )
}

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

  it('is pending only on types that still exist and still need a decision', () => {
    expect(pendingDecisionDrift(declaredTypes(), PENDING_SPEC_DECISION)).toEqual([])
  })

  it('the pending-decision guard fails in both stale directions', () => {
    expect(pendingDecisionDrift(['old-name'], ['old-name'])).toEqual([])
    expect(pendingDecisionDrift([], ['old-name'])).toEqual(['old-name'])
    expect(pendingDecisionDrift(['settled_name'], ['settled_name'])).toEqual(['settled_name'])
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
      'critic-comment',
    ]
    const declared = new Set(declaredTypes())
    expect(renamed.filter((type) => declared.has(type))).toEqual([])
  })

  it('keeps the rendered CSS class hyphenated', () => {
    // The AST type is `critic_comment`, the CSS class stays `critic-comment`.
    // They look like the same name mid-rename, but they are different surfaces:
    // the class is user-visible styling that the docs theme, the Prism grammar
    // and the published examples all select on, so renaming it in sympathy with
    // the node type would break stylesheets for no gain.
    expect(carveToHtml('a {# note #} b\n')).toContain('<span class="critic-comment">')
    expect(declaredTypes()).toContain('critic_comment')
  })

  it('keeps the types the spec adopted from carve-js', () => {
    // The spec took carve-js's shape for these rather than folding them into a
    // neighbour, so they must survive the convergence.
    const declared = new Set(declaredTypes())
    expect(declared.has('autolink')).toBe(true)
    expect(declared.has('admonition')).toBe(true)
  })
})
