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

  it('lets an application resolve conflicts without editing conflict markers', () => {
    const base = carveToAstJson('# Base\n')
    const ours = carveToAstJson('# Ours\n')
    const theirs = carveToAstJson('# Theirs\n')
    const result = mergeAst(base, ours, theirs, {
      resolve: (conflict) => (conflict.path.endsWith('/value') ? 'ours' : 'theirs'),
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(JSON.stringify(result.ast)).toContain('Ours')
  })

  it('combines concurrent insertions in the same gap', () => {
    const result = merge('one\n', 'one\n\ntwo\n', 'one\n\nthree\n')
    expect(result.ok).toBe(true)
    if (result.ok) {
      const json = JSON.stringify(result.ast)
      expect(json).toContain('two')
      expect(json).toContain('three')
    }
  })

  it('deduplicates the same concurrent insertion', () => {
    const result = merge('one\n', 'one\n\ntwo\n', 'one\n\ntwo\n')
    expect(result.ok).toBe(true)
    if (result.ok) expect(JSON.stringify(result.ast).match(/"two"/g)).toHaveLength(1)
  })

  it('merges an edit into a node moved by the other side', () => {
    const result = merge('alpha\n\nbeta\n', 'beta\n\nalpha\n', 'alpha\n\nbeta edited\n')
    expect(result.ok).toBe(true)
    if (result.ok) {
      const json = JSON.stringify(result.ast)
      expect(json.indexOf('beta edited')).toBeLessThan(json.indexOf('alpha'))
    }
  })

  it('reports incompatible concurrent orders', () => {
    const result = merge(
      'alpha\n\nbeta\n\ngamma\n',
      'beta\n\nalpha\n\ngamma\n',
      'alpha\n\ngamma\n\nbeta\n',
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.conflicts.map((conflict) => conflict.reason)).toContain(
        'concurrent-sequence-edit',
      )
    }
  })

  it('reports a deletion against an edit', () => {
    const result = merge('alpha\n\nbeta\n', 'alpha\n', 'alpha\n\nbeta edited\n')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.conflicts.map((conflict) => conflict.reason)).toContain('delete-edit')
    }
  })

  it('distinguishes deletion from a literal null in machine-readable conflicts', () => {
    const result = merge('alpha\n\nbeta\n', 'alpha\n', 'alpha\n\nbeta edited\n')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.conflicts.find((item) => item.reason === 'delete-edit')?.deleted?.ours).toBe(
        true,
      )
    }
  })
})
