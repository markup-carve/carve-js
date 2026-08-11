import { describe, expect, it } from 'vitest'

import { carveToAstJson, mergeAst } from '../src/index.js'

const merge = (base: string, ours: string, theirs: string) =>
  mergeAst(carveToAstJson(base), carveToAstJson(ours), carveToAstJson(theirs))

describe('three-way structural merge', () => {
  it('returns the unchanged document', () => {
    const result = merge('# H\n\none\n', '# H\n\none\n', '# H\n\none\n')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.ast.children).toHaveLength(2)
  })

  it('takes a one-sided edit', () => {
    const result = merge('see [docs](/a)\n', 'see [docs](/b)\n', 'see [docs](/a)\n')
    expect(result.ok).toBe(true)
    if (result.ok) expect(JSON.stringify(result.ast)).toContain('/b')
  })

  it('combines independent edits in different nodes', () => {
    const base = '# Old\n\nsee [docs](/a)\n'
    const ours = '# New\n\nsee [docs](/a)\n'
    const theirs = '# Old\n\nsee [docs](/b)\n'
    const result = merge(base, ours, theirs)
    expect(result.ok).toBe(true)
    if (result.ok) {
      const json = JSON.stringify(result.ast)
      expect(json).toContain('New')
      expect(json).toContain('/b')
      expect(json).not.toContain('"pos"')
    }
  })

  it('reports both edits to the same scalar', () => {
    const result = merge('# Base\n', '# Ours\n', '# Theirs\n')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.conflicts.length).toBeGreaterThan(0)
      expect(result.conflicts.map((conflict) => conflict.reason)).toEqual(
        expect.arrayContaining(['both-changed']),
      )
      expect(result.conflicts.map((conflict) => conflict.path)).toEqual(
        expect.arrayContaining([expect.stringContaining('value')]),
      )
    }
  })

  it('refuses ambiguous concurrent sequence edits', () => {
    const result = merge('one\n', 'one\n\ntwo\n', 'zero\n\nother\n')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.conflicts.map((conflict) => conflict.reason)).toContain(
        'concurrent-sequence-edit',
      )
    }
  })
})
