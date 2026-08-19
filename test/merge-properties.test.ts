import { describe, expect, it } from 'vitest'

import { applyAstPatch, carveToAstJson, mergeAst } from '../src/index.js'

const clean = (source: string) => applyAstPatch(carveToAstJson(source), [])

function document(seed: number, count: number): string {
  let state = seed >>> 0
  const next = (): number => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state
  }
  return Array.from({ length: count }, (_, index) => `paragraph ${index} value ${next()}`).join('\n\n') + '\n'
}

describe('three-way merge properties', () => {
  it('a revision merged against an unchanged side is exactly that revision', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const base = document(seed, 3 + (seed % 9))
      const revision = `${base}\nadded ${seed}\n`
      const result = mergeAst(carveToAstJson(base), carveToAstJson(revision), carveToAstJson(base))
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.ast).toEqual(clean(revision))
    }
  })

  it('refuses ambiguous duplicate identity instead of inventing a pairing', () => {
    const base = 'same\n\nsame\n\ntail\n'
    const ours = 'same\n\ntail\n\nsame\n'
    const theirs = 'same edited\n\nsame\n\ntail\n'
    const result = mergeAst(carveToAstJson(base), carveToAstJson(ours), carveToAstJson(theirs))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.conflicts.map((conflict) => conflict.reason)).toContain(
        'concurrent-sequence-edit',
      )
    }
  })

  it('bounds a large ambiguous sibling list', () => {
    const base = document(1, 2_000)
    const ours = base.replaceAll(' value ', ' ours ')
    const theirs = base.replaceAll(' value ', ' theirs ')
    const started = performance.now()
    const result = mergeAst(carveToAstJson(base), carveToAstJson(ours), carveToAstJson(theirs))
    expect(performance.now() - started).toBeLessThan(2_500)
    expect(result.ok).toBe(false)
  }, 10_000)
})
